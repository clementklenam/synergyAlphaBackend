import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import http from 'http';


const SYNERGY_API_URL = process.env.SYNERGY_API_URL || 'https://synergyalphaapi.onrender.com';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = http.createServer(app);

// Increase timeouts to prevent connection reset issues
server.keepAliveTimeout = 120000; // 120 seconds
server.headersTimeout = 120000; // 120 seconds

// Updated CORS configuration to allow all origins during development
const corsOptions = {
    origin: ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000', 'http://127.0.0.1:3001', /\.render\.com$/],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
};



// Apply CORS middleware globally
app.use(cors(corsOptions));

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

// added health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/search', async (req, res) => {
    try {
        const { query, limit = 20, page = 1 } = req.query;
        console.log('Search requested for:', query);

        if (!query) {
            return res.status(400).json({ error: 'Query parameter is required' });
        }

        const searchUrl = `${SYNERGY_API_URL}/search?query=${encodeURIComponent(query)}&limit=${limit}&page=${page}`;
        console.log('Search URL:', searchUrl);

        const searchResponse = await fetch(searchUrl);
        const responseText = await searchResponse.text(); // First, get the response as text

        let responseData;
        try {
            responseData = JSON.parse(responseText); // Then parse it as JSON
        } catch (error) {
            console.error('Failed to parse JSON response:', responseText);
            throw new Error(`Failed to parse JSON: ${error.message}. Raw response: ${responseText.substring(0, 200)}`);
        }

        if (!searchResponse.ok) {
            throw new Error(`Synergy API error (${searchResponse.status}): ${JSON.stringify(responseData)}`);
        }

        // Validate response data structure
        if (!responseData.results || !Array.isArray(responseData.results)) {
            console.error('Invalid search data structure:', responseData);
            throw new Error('Invalid search data structure returned from API');
        }

        console.log(`Found ${responseData.results.length} results for query "${query}"`);
        res.json(responseData);

    } catch (error) {
        console.error('Server error during search:', error);
        res.status(500).json({
            error: 'Failed to fetch search data',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
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

        const cleanSymbol = symbol.toUpperCase().trim();
        console.log(`Fetching balance sheet data for symbol: ${cleanSymbol}`);

        const balanceSheetUrl = `${SYNERGY_API_URL}/companies/${cleanSymbol}/balance-sheet?period=${period}`;
        console.log('Balance Sheet URL:', balanceSheetUrl);

        const response = await fetch(balanceSheetUrl);
        console.log('Response status:', response.status);

        const responseText = await response.text();
        console.log('Raw response:', responseText.substring(0, 200)); // Log first 200 chars for debugging

        let data;
        try {
            data = JSON.parse(responseText);
        } catch (error) {
            console.error('Failed to parse balance sheet JSON:', error);
            throw new Error(`Failed to parse JSON response: ${error.message}`);
        }

        if (!response.ok) {
            throw new Error(`API returned status ${response.status}: ${JSON.stringify(data)}`);
        }

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
