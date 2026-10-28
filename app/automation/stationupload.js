const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://192.168.16.127';

async function login(page, user) {
    await page.goto(`${BASE_URL}/Login`);
    await page.locator('#UserId').fill(user.username);
    await page.locator('#Password').fill(user.password);

    await Promise.all([
        page.waitForURL(`${BASE_URL}/`),
        page.getByRole('button', { name: 'Sign In' }).click()
    ]);
}

async function uploadStation(page, station, stationRootPath) {
    const stationFolder = path.join(stationRootPath, station);

    const requiredFiles = [
        'LOGIC11_NEW.csv',
        'LOGIC11_OLD.csv',
        'TEMPLATE.pdf',
        'TEMPLATE.dwg'
    ];

    for (const fileName of requiredFiles) {
        const filePath = path.join(stationFolder, fileName);

        if (!fs.existsSync(filePath)) {
            throw new Error(`Missing required file: ${fileName}`);
        }
    }

    await page.goto(`${BASE_URL}/BBCT`, { waitUntil: 'domcontentloaded' });

    await page.locator('#selCountry_chosen').click();
    await page.locator('#selCountry_chosen .chosen-results li')
        .getByText('India').click();

    await page.locator('#selDivisionName_chosen').click();
    await page.locator('#selDivisionName_chosen .chosen-results li')
        .getByText('NR / Delhi').click();

    await page.locator('#selStationName_chosen').click();
    await page.locator('#selStationName_chosen .chosen-results li')
        .getByText('HIND').click();

    await page.locator('#txtStationCode').fill('0001');
    await page.locator('#txtProjectCode').fill('0001');

    await page.locator('#selIndexType_chosen').click();
    await page.locator('#selIndexType_chosen .chosen-results li')
        .getByText('Logic Name').click();

    await page.locator('#selCircuitType_chosen').click();
    await page.locator('#selCircuitType_chosen .chosen-results li')
        .getByText('New method with Comparison & Report', { exact: true }).click();

    await page.locator('#selCompCirType_chosen').click();
    await page.locator('#selCompCirType_chosen .chosen-results li')
        .getByText('Modified circuits ').click();

    await page.locator('#fileCAD').setInputFiles(
        path.join(stationFolder, 'TEMPLATE.dwg')
    );

    await page.locator('#filePDF').setInputFiles(
        path.join(stationFolder, 'TEMPLATE.pdf')
    );

    await page.locator('#fileLogic').setInputFiles(
        path.join(stationFolder, 'LOGIC11_NEW.csv')
    );

    await page.locator('#oldfileLogic').setInputFiles(
        path.join(stationFolder, 'LOGIC11_OLD.csv')
    );

    const generateResponsePromise = page.waitForResponse(
        response =>
            response.request().method() === 'POST' &&
            response.url().includes('/Generation'),
        { timeout: 100000 }
    );

    await page.locator('#btnGenerate').click();

    const response = await generateResponsePromise;

    let responseBody;

    try {
        responseBody = await response.json();
    } catch {
        responseBody = await response.text();
    }

    if (!response.ok()) {
        throw new Error(
            `Generation API failed with status ${response.status()}`
        );
    }

    return {
        station,
        apiStatus: response.status(),
        apiResponse: responseBody
    };
}

async function runStationUploads(stations, users, stationRootPath) {
    const results = [];

    const userTasks = users.map(user => ({
        user,
        stations: []
    }));

    stations.forEach((station, index) => {
        const userIndex = index % users.length;
        userTasks[userIndex].stations.push(station);
    });

    await Promise.all(
        userTasks.map(async ({ user, stations }) => {
            if (!stations.length) return;

            const browser = await chromium.launch({ headless: false, channel: 'msedge' });
            const context = await browser.newContext();
            const page = await context.newPage();

            try {
                await login(page, user);

                for (const station of stations) {
                    try {
                        const result = await uploadStation(
                            page,
                            station,
                            stationRootPath
                        );

                        results.push({
                            station,
                            user: user.username,
                            status: 'SUCCESS',
                            apiStatus: result.apiStatus,
                            apiResponse: result.apiResponse
                        });
                    } catch (error) {
                        results.push({
                            station,
                            user: user.username,
                            status: 'FAILED',
                            reason: error.message,
                            apiResponse: null
                        });
                    }
                }
            } finally {
                await browser.close();
            }
        })
    );

    return results;
}

module.exports = { runStationUploads };