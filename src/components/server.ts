import * as http from 'http'
import * as https from 'https'
import * as ws from 'ws'
import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'

import {Extension} from '../main'
import {AddressInfo} from 'net'

export class Server {
    extension: Extension
    server: https.Server | http.Server
    wsServer: ws.Server
    address: string
    port: number

    constructor(extension: Extension) {
        this.extension = extension
        const configuration = vscode.workspace.getConfiguration('latex-workshop')
        const viewerPort = configuration.get('viewer.pdf.internal.port') as number
        const viewerAddress = configuration.get('viewer.pdf.internal.address') as string
        const usehttps = configuration.get('viewer.pdf.internal.usehttps') as boolean
        if (usehttps) {
            const options = {
                key: configuration.get('viewer.pdf.internal.https.keyPath') as string,
                cert: configuration.get('viewer.pdf.internal.https.certPath') as string
            }
            this.server = https.createServer(options, (request, response) => this.handler(request, response))
        } else {
            this.server = http.createServer((request, response) => this.handler(request, response))
        }
        this.server.listen(viewerPort, viewerAddress, undefined, (err: Error) => {
            if (err) {
                this.extension.logger.addLogMessage(`Error creating LaTeX Workshop http server: ${err}.`)
            } else {
                const {address, port} = this.server.address() as AddressInfo
                if (address.indexOf(':') > -1) {
                    // the colon is reserved in URL to separate IPv4 address from port number. IPv6 address needs to be enclosed in square brackets when used in URL
                    this.address = `[${address}]`
                    this.port = port
                } else {
                    this.address = `${address}`
                    this.port = port
                }
                this.extension.logger.addLogMessage(`Server created on ${this.address}:${this.port}`)
            }
        })
        this.server.on('error', (err) => {
            this.extension.logger.addLogMessage(`Error creating LaTeX Workshop http server: ${err}.`)
        })
        this.wsServer = new ws.Server({server: this.server})
        this.wsServer.on('connection', (websocket) => {
            websocket.on('message', (msg: string) => this.extension.viewer.handler(websocket, msg))
            websocket.on('close', () => this.extension.viewer.handler(websocket, '{"type": "close"}'))
            websocket.on('error', () => this.extension.logger.addLogMessage('Error on WebSocket connection.'))
        })
        this.extension.logger.addLogMessage(`Creating LaTeX Workshop http and websocket server.`)
    }

    handler(request: http.IncomingMessage, response: http.ServerResponse) {
        if (!request.url) {
            return
        }

        if (request.url.indexOf('pdf:') >= 0 && request.url.indexOf('viewer.html') < 0) {
            // The second backslash was encoded as %2F, and the first one is prepended by request
            const fileName = decodeURIComponent(request.url.replace('/pdf:', ''))
            try {
                const pdfSize = fs.statSync(fileName).size
                response.writeHead(200, {'Content-Type': 'application/pdf', 'Content-Length': pdfSize})
                fs.createReadStream(fileName).pipe(response)
                this.extension.logger.addLogMessage(`Preview PDF file: ${fileName}`)
            } catch (e) {
                response.writeHead(404)
                response.end()
                this.extension.logger.addLogMessage(`Error reading PDF file: ${fileName}`)
            }
            return
        } else {
            let root: string
            if (request.url.startsWith('/build/') || request.url.startsWith('/cmaps/')) {
                root = path.resolve(`${this.extension.extensionRoot}/node_modules/pdfjs-dist`)
            } else {
                root = path.resolve(`${this.extension.extensionRoot}/viewer`)
            }
            const fileName = path.resolve(root, '.' + request.url.split('?')[0])
            let contentType = 'text/html'
            switch (path.extname(fileName)) {
                case '.js':
                    contentType = 'text/javascript'
                    break
                case '.css':
                    contentType = 'text/css'
                    break
                case '.json':
                    contentType = 'application/json'
                    break
                case '.png':
                    contentType = 'image/png'
                    break
                case '.jpg':
                    contentType = 'image/jpg'
                    break
                case '.ico':
                    contentType = 'image/x-icon'
                    break
                default:
                    break
            }
            fs.readFile(fileName, (err, content) => {
                if (err) {
                    if (err.code === 'ENOENT') {
                        response.writeHead(404)
                    } else {
                        response.writeHead(500)
                    }
                    response.end()
                } else {
                    response.writeHead(200, {'Content-Type': contentType})
                    response.end(content, 'utf-8')
                }
            })
        }
    }
}
