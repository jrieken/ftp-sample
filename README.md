# ftp-filesystem 

This is a sample that uses FTP to implement a file system provider in VS Code. We try to keep this extension up-to-date as we are refining and changing the proposed API for remote file systems.

# Try It

You a couple of things before you can start

* have a ftp server to talk to
* update [`extension.ts`](https://github.com/jrieken/ftp-sample/blob/master/src/extension.ts#L14) with your server details (address and auth)
* re-compile via `npm run compile`

Now you can run this extension but make sure to open a Workspace.

* Press F5 to start a new instance of VS Code
* Ensure you have a Workspace (not a plain folder or file) open
    * Select 'F1 > Save Workspace As...' and follow the steps
    * Reload the window

At this moment you should see files and folders from your ftp-server showing up in the explorer. 

![Sample](https://github.com/jrieken/ftp-sample/blob/master/remote_fs.png)
