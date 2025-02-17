import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = http.createServer(app);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const RETRY_COUNT = 3;
const RETRY_DELAY = 1000; // 1 second
// Helper function to check if response is HTML
const isHtmlResponse = (text) => {
    return text.trim().toLowerCase().startsWith('<!doctype html>') ||
        text.trim().toLowerCase().startsWith('<html');
};

// Increase timeouts to prevent connection reset issues
server.keepAliveTimeout = 120000; // 120 seconds
server.headersTimeout = 120000; // 120 seconds

// Updated CORS configuration to allow all origins during development
if (process.env.NODE_ENV === 'production') {
    app.use(cors({
        origin: [
            'https://your-render-frontend-url.com',
            /\.render\.com$/
        ]
    }));
} else {
    app.use(cors({
        origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
        credentials: true
    }));
}

const SYNERGY_API_URL = 'https://synergyalphaapi.onrender.com';

// Debug middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Add error handling middleware
app.use((err, req, res, next) => {
    console.error('Global error handler:', err);
    res.status(500).json({
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred',
        timestamp: new Date().toISOString()
    });
});



app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/balance-sheet/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;
        const { period = 'annual' } = req.query;

        if (!symbol) {
            return res.status(400).json({ error: 'Symbol parameter is required' });
        }

        const cleanSymbol = symbol.toLowerCase().trim();
        console.log(`Fetching balance sheet data for symbol: ${cleanSymbol}`);

        const balanceSheetUrl = `${SYNERGY_API_URL}/companies/${cleanSymbol}/balance-sheet?period=${period}`;
        console.log('Request URL:', balanceSheetUrl);

        const response = await fetch(balanceSheetUrl);
        console.log('Response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API returned status ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        console.log('Successfully fetched balance sheet data for:', cleanSymbol);
        res.json(data);

    } catch (error) {
        console.error('Detailed error:', error);
        res.status(500).json({
            error: 'Failed to fetch balance sheet data',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Helper function to make request with retry logic
async function fetchWithRetry(url, options = {}, retries = RETRY_COUNT) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            const responseText = await response.text();

            // Check if response is HTML (indicating an error page)
            if (isHtmlResponse(responseText)) {
                throw new Error('Received HTML response instead of JSON');
            }

            // Try to parse JSON
            let data;
            try {
                data = JSON.parse(responseText);
            } catch (parseError) {
                throw new Error(`Invalid JSON response: ${responseText.substring(0, 100)}...`);
            }

            // Check if response was successful
            if (!response.ok) {
                throw new Error(`API returned status ${response.status}: ${JSON.stringify(data)}`);
            }

            return data;
        } catch (error) {
            console.error(`Attempt ${i + 1}/${retries} failed:`, error.message);

            // If this was the last attempt, throw the error
            if (i === retries - 1) {
                throw error;
            }

            // Wait before retrying
            await delay(RETRY_DELAY * (i + 1)); // Exponential backoff
        }
    }
}

// Updated search endpoint
app.get('/api/search', async (req, res) => {
    try {
        const { query, limit = 20, page = 1 } = req.query;
        console.log('Search requested for:', query);

        if (!query) {
            return res.status(400).json({
                error: 'Query parameter is required',
                timestamp: new Date().toISOString()
            });
        }

        const searchUrl = `${SYNERGY_API_URL}/search?query=${encodeURIComponent(query)}&limit=${limit}&page=${page}`;
        console.log('Search URL:', searchUrl);

        const responseData = await fetchWithRetry(searchUrl);

        // Validate response data structure
        if (!responseData.results || !Array.isArray(responseData.results)) {
            throw new Error('Invalid data structure returned from API');
        }

        console.log(`Found ${responseData.results.length} results for query "${query}"`);

        // Return successful response
        res.json({
            status: 'success',
            data: responseData,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Search error:', error);

        // Determine appropriate status code
        const statusCode = error.message.includes('API returned status') ? 502 : 500;

        // Send detailed error response
        res.status(statusCode).json({
            error: 'Failed to fetch search data',
            details: error.message,
            retryable: statusCode === 502, // Indicate if the client should retry
            timestamp: new Date().toISOString()
        });
    }
});

// Fixed earnings endpoint with separate response handling
async function handleApiResponse(response, source) {
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch (error) {
        console.error(`Failed to parse ${source} JSON:`, text);
        throw new Error(`Failed to parse ${source} response: ${error.message}`);
    }
}

app.get('/api/earnings', async (req, res) => {
    try {
        const { symbol } = req.query;
        console.log('Requested symbol:', symbol);

        if (!symbol) {
            return res.status(400).json({ error: 'Symbol is required' });
        }

        const today = new Date();
        const threeMonthsFromNow = new Date();
        threeMonthsFromNow.setMonth(today.getMonth() + 3);

        const fromDate = today.toISOString().split('T')[0];
        const toDate = threeMonthsFromNow.toISOString().split('T')[0];

        // Calendar data fetch
        console.log('Fetching calendar data...');
        const calendarUrl = `https://finnhub.io/api/v1/calendar/earnings?from=${fromDate}&to=${toDate}&symbol=${symbol}`;
        console.log('Calendar URL:', calendarUrl);

        const calendarResponse = await fetch(calendarUrl, {
            headers: {
                'X-Finnhub-Token': process.env.FINNHUB_API_KEY
            }
        });

        const calendarData = await handleApiResponse(calendarResponse, 'Calendar');

        // Estimates data fetch
        console.log('Fetching estimates data...');
        const estimatesUrl = `https://finnhub.io/api/v1/stock/earnings-estimates?symbol=${symbol}&freq=quarterly`;

        const estimatesResponse = await fetch(estimatesUrl, {
            headers: {
                'X-Finnhub-Token': process.env.FINNHUB_API_KEY
            }
        });

        const estimatesData = await handleApiResponse(estimatesResponse, 'Estimates');

        // Validate response data structure
        if (!Array.isArray(calendarData.earningsCalendar)) {
            throw new Error('Invalid calendar data structure');
        }

        if (!Array.isArray(estimatesData.earningsEstimates)) {
            throw new Error('Invalid estimates data structure');
        }

        res.json({
            calendar: calendarData,
            estimates: estimatesData
        });

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({
            error: 'Failed to fetch earnings data',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

const PORT = process.env.PORT || 10000; // Use Render's default port if not specified
const HOST = '0.0.0.0'; // Bind to all network interfaces

server.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
    console.log('Available endpoints:');
    console.log('- GET /api/search - Search for stocks');
    console.log('- GET /api/earnings - Get earnings data for a stock');
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Performing graceful shutdown...');
    server.close(() => {
        console.log('Server closed. Exiting process.');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received. Performing graceful shutdown...');
    server.close(() => {
        console.log('Server closed. Exiting process.');
        process.exit(0);
    });
});