#!/usr/bin/env node

const http = require('http');
const https = require('https');
const net = require('net');
const url = require('url');
const os = require('os');
const fs = require('fs');
const { exec } = require('child_process');
const readline = require('readline');

const asciiArt = `
#####################################################################
#                                                                   #
#     .sSSSSs.    .sSSSSs.                                         #
#   SSSSSSSSSSs. SSSSSSSSSs.      .sSSSSSSSSSSSSSs. .sSSSSSSSs.    #
#   S SSS SSSSS S SSS SSSSS        SSSSS S SSS SSSSS S SSS SSSSS    #
#   S  SS SSSS' S  SS SSSS'        SSSSS S  SS SSSSS S  SS SSSS'    #
#   S..SSsSSSa. S..SSsSSSa. sssssss S..SS S..SS S..SSsSSSa.        #
#   S:::S SSSSS S:::S SSSSS         S:::S     S:::S SSSSS          #
#   S;;;S SSSSS S;;;S SSSSS         S;;;S     S;;;S SSSSS          #
#   S%%%S SSSSS S%%%S SSSSS         S%%%S     S%%%S SSSSS          #
#   SSSSSsSSSS' SSSSS SSSSS         SSSSS     SSSSS SSSSS          #
#                                                                   #
#           TRAFFIC MONITOR v1.0                                   #
#             BROWSER TRAFFIC STATS                                #
#                                                                   #
#####################################################################
`;

class TrafficMonitor {
    constructor() {
        this.stats = {
            requests: 0,
            totalBytes: 0,
            activeConns: 0,
            errors: 0,
            startTime: Date.now(),
            domains: {},
            methods: { GET: 0, POST: 0, PUT: 0, DELETE: 0, OTHER: 0 },
            statusCodes: {}
        };
        this.proxy = null;
        this.botProcess = null;
    }

    startProxy(port = 8888) {
        this.proxy = http.createServer((req, res) => {
            this.handleRequest(req, res);
        });

        this.proxy.on('connect', (req, clientSocket, head) => {
            this.handleTunnel(req, clientSocket, head);
        });

        this.proxy.listen(port, '127.0.0.1', () => {
            this.printHeader();
            console.log('#  PROXY RUNNING ON 127.0.0.1:' + port);
            console.log('#  CONFIGURE YOUR BROWSER TO USE THIS PROXY');
            console.log('#  PRESS CTRL+C TO STOP');
            console.log('#####################################################################\n');
        });

        this.proxy.on('error', (err) => {
            this.stats.errors++;
            console.log('#  ERROR: ' + err.message);
        });
    }

    handleRequest(req, res) {
        this.stats.requests++;
        const reqUrl = url.parse(req.url);
        const domain = reqUrl.hostname || 'unknown';
        const method = req.method;

        if (!this.stats.domains[domain]) this.stats.domains[domain] = 0;
        this.stats.domains[domain]++;

        if (this.stats.methods[method]) this.stats.methods[method]++;
        else this.stats.methods['OTHER']++;

        let bodyChunks = [];
        let bodySize = 0;

        req.on('data', chunk => {
            bodyChunks.push(chunk);
            bodySize += chunk.length;
            this.stats.totalBytes += chunk.length;
        });

        req.on('end', () => {
            const options = {
                hostname: reqUrl.hostname,
                port: reqUrl.port || 80,
                path: reqUrl.path,
                method: method,
                headers: req.headers
            };

            const proxyReq = http.request(options, (proxyRes) => {
                this.stats.statusCodes[proxyRes.statusCode] = (this.stats.statusCodes[proxyRes.statusCode] || 0) + 1;
                res.writeHead(proxyRes.statusCode, proxyRes.headers);
                proxyRes.on('data', chunk => {
                    this.stats.totalBytes += chunk.length;
                    res.write(chunk);
                });
                proxyRes.on('end', () => res.end());
            });

            proxyReq.on('error', (err) => {
                this.stats.errors++;
                res.writeHead(500);
                res.end();
            });

            bodyChunks.forEach(chunk => proxyReq.write(chunk));
            proxyReq.end();
        });
    }

    handleTunnel(req, clientSocket, head) {
        this.stats.activeConns++;
        const { port, hostname } = url.parse('https://' + req.url);

        const serverSocket = net.connect(port || 443, hostname, () => {
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            serverSocket.write(head);
            serverSocket.pipe(clientSocket);
            clientSocket.pipe(serverSocket);
        });

        serverSocket.on('error', (err) => {
            this.stats.errors++;
            clientSocket.end();
        });

        clientSocket.on('close', () => {
            this.stats.activeConns--;
            serverSocket.end();
        });
    }

    printStats() {
        const uptime = Math.floor((Date.now() - this.stats.startTime) / 1000);
        const bytesMB = (this.stats.totalBytes / 1024 / 1024).toFixed(2);

        console.log('\n#####################################################################');
        console.log('#                      TRAFFIC STATISTICS                          #');
        console.log('#####################################################################');
        console.log('#  UPTIME: ' + uptime + ' seconds');
        console.log('#  TOTAL REQUESTS: ' + this.stats.requests);
        console.log('#  TOTAL DATA: ' + bytesMB + ' MB');
        console.log('#  ACTIVE CONNECTIONS: ' + this.stats.activeConns);
        console.log('#  ERRORS: ' + this.stats.errors);
        console.log('#-------------------------------------------------------------------#');

        console.log('#  HTTP METHODS:');
        for (let [method, count] of Object.entries(this.stats.methods)) {
            if (count > 0) console.log('#    ' + method + ': ' + count);
        }

        console.log('#-------------------------------------------------------------------#');
        console.log('#  TOP DOMAINS:');
        let sortedDomains = Object.entries(this.stats.domains).sort((a,b) => b[1] - a[1]).slice(0,5);
        for (let [domain, count] of sortedDomains) {
            console.log('#    ' + domain + ': ' + count + ' req');
        }

        console.log('#-------------------------------------------------------------------#');
        console.log('#  STATUS CODES:');
        for (let [code, count] of Object.entries(this.stats.statusCodes).slice(0,10)) {
            console.log('#    ' + code + ': ' + count);
        }
        console.log('#####################################################################\n');
    }

    printHeader() {
        console.log(asciiArt);
    }

    stopProxy() {
        if (this.proxy) {
            this.proxy.close();
            console.log('\n#####################################################################');
            console.log('#                     PROXY STOPPED                                #');
            this.printStats();
            console.log('#                     GOODBYE!                                     #');
            console.log('#####################################################################\n');
            process.exit(0);
        }
    }
}

class TrafficBotGenerator {
    constructor() {
        this.isRunning = false;
    }

    installTrafficBot() {
        return new Promise((resolve, reject) => {
            console.log('#  INSTALLING TRAFFICBOT MODULE...');
            exec('npm install trafficbot', (error, stdout, stderr) => {
                if (error) {
                    console.log('#  INSTALLATION FAILED: ' + error.message);
                    reject(error);
                } else {
                    console.log('#  TRAFFICBOT INSTALLED SUCCESSFULLY');
                    resolve();
                }
            });
        });
    }

    buildProject() {
        return new Promise((resolve, reject) => {
            console.log('#  BUILDING PROJECT...');
            exec('npm run build', (error, stdout, stderr) => {
                if (error) {
                    console.log('#  BUILD FAILED, USING DEFAULT CONFIG');
                    resolve();
                } else {
                    console.log('#  BUILD COMPLETED');
                    resolve();
                }
            });
        });
    }

    generateTraffic(urls = ['https://example.com'], duration = 30) {
        console.log('#  GENERATING TRAFFIC TO: ' + urls.join(', '));
        console.log('#  DURATION: ' + duration + ' seconds');

        const script = `
const TrafficBot = require('trafficbot');
const config = {
    urls: ${JSON.stringify(urls)},
    concurrent: 5,
    duration: ${duration},
    delay: 1000,
    randomDelay: true,
    userAgents: true,
    referers: true
};
const bot = new TrafficBot(config);
bot.start();
setTimeout(() => bot.stop(), ${duration} * 1000);
`;

        fs.writeFileSync('temp_bot.js', script);

        this.isRunning = true;
        const botProcess = exec('node temp_bot.js', (error, stdout, stderr) => {
            this.isRunning = false;
            if (error) console.log('#  TRAFFIC GENERATION ERROR: ' + error.message);
            else console.log('#  TRAFFIC GENERATION COMPLETED');
            fs.unlinkSync('temp_bot.js');
        });

        return botProcess;
    }

    runExamples() {
        console.log('#  RUNNING TRAFFICBOT EXAMPLES');
        exec('npm run run:examples', (error, stdout, stderr) => {
            if (error) console.log('#  EXAMPLES ERROR: ' + error.message);
            else console.log('#  EXAMPLES COMPLETED');
        });
    }
}

class MenuSystem {
    constructor() {
        this.monitor = new TrafficMonitor();
        this.botGenerator = new TrafficBotGenerator();
        this.rl = null;
    }

    createReadline() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    showMenu() {
        console.log('\n#####################################################################');
        console.log('#                          MAIN MENU                                #');
        console.log('#####################################################################');
        console.log('#  1. START PROXY MONITOR (CAPTURE BROWSER TRAFFIC)                 #');
        console.log('#  2. SHOW CURRENT STATISTICS                                       #');
        console.log('#  3. INSTALL & SETUP TRAFFICBOT                                    #');
        console.log('#  4. GENERATE TEST TRAFFIC                                         #');
        console.log('#  5. RUN TRAFFICBOT EXAMPLES                                       #');
        console.log('#  6. EXIT                                                          #');
        console.log('#####################################################################');
        console.log('#  ENTER YOUR CHOICE (1-6):                                         #');
    }

    askQuestion(question) {
        return new Promise((resolve) => {
            this.rl.question(question, (answer) => {
                resolve(answer);
            });
        });
    }

    async generateTrafficMenu() {
        console.log('\n#####################################################################');
        console.log('#                    GENERATE TEST TRAFFIC                         #');
        console.log('#####################################################################');
        const urlsInput = await this.askQuestion('#  ENTER URLS (comma separated, default: https://example.com): ');
        const urls = urlsInput ? urlsInput.split(',').map(u => u.trim()) : ['https://example.com'];
        const durationInput = await this.askQuestion('#  ENTER DURATION IN SECONDS (default: 30): ');
        const duration = parseInt(durationInput) || 30;

        this.botGenerator.generateTraffic(urls, duration);
        await this.askQuestion('\n#  PRESS ENTER TO CONTINUE...');
    }

    async run() {
        this.createReadline();
        let monitorRunning = false;

        while (true) {
            this.showMenu();
            const choice = await this.askQuestion('');

            switch(choice) {
                case '1':
                    if (!monitorRunning) {
                        this.monitor.startProxy(8888);
                        monitorRunning = true;

                        setInterval(() => {
                            if (monitorRunning) {
                                process.stdout.write('\x1Bc');
                                this.monitor.printHeader();
                                this.monitor.printStats();
                            }
                        }, 3000);
                    } else {
                        console.log('#  PROXY ALREADY RUNNING');
                    }
                    await this.askQuestion('#  PRESS ENTER TO CONTINUE...');
                    break;

                case '2':
                    this.monitor.printStats();
                    await this.askQuestion('#  PRESS ENTER TO CONTINUE...');
                    break;

                case '3':
                    try {
                        await this.botGenerator.installTrafficBot();
                        await this.botGenerator.buildProject();
                    } catch(e) {
                        console.log('#  SETUP FAILED: ' + e.message);
                    }
                    await this.askQuestion('#  PRESS ENTER TO CONTINUE...');
                    break;

                case '4':
                    await this.generateTrafficMenu();
                    break;

                case '5':
                    this.botGenerator.runExamples();
                    await this.askQuestion('#  PRESS ENTER TO CONTINUE...');
                    break;

                case '6':
                    if (monitorRunning) {
                        this.monitor.stopProxy();
                    }
                    console.log('\n#  EXITING... GOODBYE!');
                    this.rl.close();
                    process.exit(0);
                    break;

                default:
                    console.log('#  INVALID CHOICE!');
                    await this.askQuestion('#  PRESS ENTER TO CONTINUE...');
            }
        }
    }
}

process.on('SIGINT', () => {
    console.log('\n#  SHUTTING DOWN...');
    process.exit(0);
});

const menu = new MenuSystem();
menu.run();
