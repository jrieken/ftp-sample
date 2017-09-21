'use strict';

import * as vscode from 'vscode';
import { basename, dirname, join } from 'path';
import { Readable } from 'stream';
import * as JSFtp from 'jsftp';

export function activate(context: vscode.ExtensionContext) {

    console.log('Congratulations, your extension "ftp-filesystem" is now active!');

    let disposable = vscode.workspace.registerFileSystemProvider(
        'ftp',
        new FtpFileSystemProvider(vscode.Uri.parse('ftp://waws-prod-db3-029.ftp.azurewebsites.windows.net/'))
    );

    context.subscriptions.push(disposable);
}

class FtpFileSystemProvider implements vscode.FileSystemProvider {

    private _connection: JSFtp;
    private _pending: { resolve: Function, reject: Function, func: keyof JSFtp, args: any[] }[] = [];

    constructor(
        public readonly root: vscode.Uri
    ) {

    }

    private _withConnection<T>(func: keyof JSFtp, ...args: any[]): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this._pending.push({ resolve, reject, func, args });
            this._nextRequest();
        });
    }

    private _nextRequest(): void {
        if (this._pending.length === 0) {
            return;
        }

        if (this._connection === void 0) {
            // ensure connection first
            const candidate = new JSFtp({
                host: this.root.authority
            });
            candidate.keepAlive(1000 * 5);

            candidate.auth('USER', 'PASS', (err) => {
                this._connection = err ? null : candidate;
                this._nextRequest();
            });

            return;

        }

        if (this._connection === null) {
            // permanently failed
            const request = this._pending.shift();
            request.reject(new Error('no connection'))

        } else {
            // connected
            const { func, args, resolve, reject } = this._pending.shift();
            (<Function>this._connection[func]).apply(this._connection, args.concat([function (err, res) {
                if (err) {
                    reject(err);
                } else {
                    resolve(res);
                }
            }]));
        }

        this._nextRequest();
    }

    dispose(): void {
        this._withConnection('raw', 'QUIT');
    }

    utimes(resource: vscode.Uri, mtime: number): Promise<vscode.FileStat> {
        return this._withConnection('raw', 'NOOP')
            .then(() => this.stat(resource));
    }

    stat(resource: vscode.Uri): Promise<vscode.FileStat> {
        const { path } = resource;
        if (path === '/' || path === '') {
            // root directory
            return Promise.resolve(<vscode.FileStat>{
                type: vscode.FileType.Dir,
                id: null,
                mtime: 0,
                size: 0
            });
        }

        const name = basename(path);
        const dir = dirname(path);
        return this._withConnection<JSFtp.Entry[]>('ls', dir).then(entries => {
            for (const entry of entries) {
                if (entry.name === name) {
                    return {
                        id: null,
                        mtime: entry.time,
                        size: entry.size,
                        type: entry.type
                    };
                }
            }
            return Promise.reject<vscode.FileStat>(new Error(`ENOENT, ${resource.toString(true)}`));
        }, err => {
            return Promise.reject<vscode.FileStat>(new Error(`ENOENT, ${resource.toString(true)}`));
        });
    }

    readdir(dir: vscode.Uri): Promise<[vscode.Uri, vscode.FileStat][]> {
        return this._withConnection<JSFtp.Entry[]>('ls', dir.path).then(entries => {
            const result: [vscode.Uri, vscode.FileStat][] = [];
            for (let entry of entries) {
                const resource = dir.with({ path: join(dir.path, entry.name) });
                const stat: vscode.FileStat = {
                    id: resource.toString(),
                    mtime: entry.time,
                    size: entry.size,
                    type: entry.type
                }
                result.push([resource, stat]);
            }
            return result;
        });
    }

    read(resource: vscode.Uri, offset: number, count: number, progress: vscode.Progress<Uint8Array>): Promise<number> {
        return this._withConnection<Readable>('get', resource.path).then(stream => {

            let read = 0;
            let ignoreBefore = true;
            let ignoreAfter = false;

            return new Promise<number>((resolve, reject) => {
                stream.on('data', (buffer: Buffer) => {
                    read += buffer.length;
                    // soo sad, I have no clue how to read 
                    // a portion of a file via ftp...
                    if (ignoreBefore) {
                        if (read > offset) {
                            let diff = read - offset;
                            let slice = buffer.slice(buffer.length - diff);
                            progress.report(slice);
                            ignoreBefore = false;
                            read = diff;
                        }
                    } else if (!ignoreAfter) {
                        progress.report(buffer);
                        if (read > count) {
                            ignoreAfter = true;
                        }
                    }
                });
                stream.on('close', hadErr => {
                    if (hadErr) {
                        reject(hadErr);
                    } else {
                        resolve(read);
                    }
                });
                stream.resume();
            });
        });
    }

    write(resource: vscode.Uri, content: Uint8Array): Promise<void> {
        return this._withConnection('put', content, resource.path);
    }

    rmdir(resource: vscode.Uri): Promise<void> {
        return this._withConnection('raw', 'RMD', [resource.path]);
    }

    mkdir(resource: vscode.Uri): Promise<vscode.FileStat> {
        return this._withConnection('raw', 'MKD', [resource.path])
            .then(() => this.stat(resource));
    }

    unlink(resource: vscode.Uri): Promise<void> {
        return this._withConnection('raw', 'DELE', [resource.path]);
    }

    move(resource: vscode.Uri, target: vscode.Uri): Promise<vscode.FileStat> {
        return this._withConnection<void>('raw', 'RNFR', [resource.path]).then(() => {
            return this._withConnection<void>('raw', 'RNTO', [target.path]);
        }).then(() => {
            return this.stat(target);
        });
    }
}
