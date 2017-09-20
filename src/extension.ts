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

    private _connection: Promise<JSFtp>;

    constructor(
        public readonly root: vscode.Uri
    ) {
        this._connection = new Promise<JSFtp>((resolve, reject) => {
            const connection = new JSFtp({ host: root.authority });
            connection.keepAlive(1000 * 5);
            connection.auth('USER', 'PASS', (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(connection);
                }
            });
        });
    }

    private _withConnection<T>(func: keyof JSFtp, ...args: any[]): Promise<T> {
        return this._connection.then(connection => {
            return new Promise<T>((resolve, reject) => {
                (<Function>connection[func]).apply(connection, args.concat([function (err, result) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(result);
                    }
                }]));
            });
        });
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
                resource,
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
                        resource,
                        mtime: entry.time,
                        size: entry.size,
                        type: entry.type
                    };
                }
            }
            // console.log(entries, name, resource);
            return Promise.reject<vscode.FileStat>(`ENOENT, ${resource.path}`);
        });
    }

    readdir(resource: vscode.Uri): Promise<vscode.FileStat[]> {
        return this._withConnection<JSFtp.Entry[]>('ls', resource.path).then(ret => {
            const result: vscode.FileStat[] = [];
            for (let entry of ret) {
                result.push({
                    resource: resource.with({ path: join(resource.path, entry.name) }),
                    mtime: entry.time,
                    size: entry.size,
                    type: entry.type
                });
            }
            return result;
        });
    }

    read(resource: vscode.Uri, progress: vscode.Progress<Uint8Array>): Promise<void> {
        return this._withConnection<Readable>('get', resource.path).then(stream => {
            return new Promise<void>((resolve, reject) => {
                stream.on('data', d => progress.report(<any>d));
                stream.on('close', hadErr => {
                    if (hadErr) {
                        reject(hadErr);
                    } else {
                        resolve(undefined);
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

    mkdir(resource: vscode.Uri): Promise<void> {
        return this._withConnection('raw', 'MKD', [resource.path]);
    }

    unlink(resource: vscode.Uri): Promise<void> {
        return this._withConnection('raw', 'DELE', [resource.path]);
    }

    rename(resource: vscode.Uri, target: vscode.Uri): Promise<void> {
        return this._withConnection<void>('raw', 'RNFR', [resource.path]).then(() => {
            return this._withConnection<void>('raw', 'RNTO', [target.path]);
        });
    }
}
