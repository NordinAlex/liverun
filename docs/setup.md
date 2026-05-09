# Local Development Setup

Follow these steps to set up `liverun` for local development.

## Prerequisites

*   [Node.js](https://nodejs.org/) (v18.0.0 or higher recommended)
*   [npm](https://www.npmjs.com/)

## Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/AlexNordin/liverun.git
    cd liverun
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

## Running Locally

To test your changes, you can use the `test-app` included in the repository.

1.  Open a terminal in the root of the project.
2.  Start the build process in watch mode. This will recompile the TypeScript code in `src/` to `dist/` whenever you make a change:
    ```bash
    npm run dev
    ```
3.  Open a second terminal window in the root of the project.
4.  Run the built CLI tool against the test app:
    ```bash
    node dist/index.js test-app/server.js
    ```

Now, when you make changes to the `liverun` source code, `tsup` will rebuild it automatically. You'll need to restart the CLI command in the second terminal to see the effects of your changes.

When you make changes to the files inside `test-app/`, the running instance of `liverun` should detect them and either restart the server or send a live-reload signal to the browser.
