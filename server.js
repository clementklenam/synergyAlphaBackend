import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// Updated CORS configuration to allow all origins during development
if (process.env.NODE_ENV === 'production') {
    // In production, specify allowed origins
    app.use(cors({
        origin: [
            // Your production frontend URL
            'https://your-render-frontend-url.com',
            // Allow relative requests if frontend and backend are deployed together
            /\.render\.com$/  // Allow all subdomains on render.com
        ]
    }));
} else {
    // In development, allow requests from the React dev server
    app.use(cors({
        origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
        credentials: true
    }));

    // Log CORS setup
    console.log('CORS configured for development with origins:', ['http://localhost:3000', 'http://127.0.0.1:3000']);
}

const SYNERGY_API_URL = 'https://synergyalphaapi.onrender.com';

// Debug middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
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

// Fixed search endpoint
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

const PORT = 5001;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Available endpoints:`);
    console.log(`- GET /api/search - Search for stocks`);
    console.log(`- GET /api/earnings - Get earnings data for a stock`);
});