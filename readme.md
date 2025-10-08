# LLM-God

## Screenshot


![image](https://github.com/user-attachments/assets/edb2c89f-2cf9-422f-860f-33d6524c074e)



This is a desktop app for Windows machines only (currently) that allows users to simultaneously prompt multiple LLM's at once in one environment. I use this app every day, for coding or non coding purposes. It has saved me countless hours of copypasting and is just so much more efficient.

Currently, the following LLM web interfaces are supported:

- ChatGPT
- Google Gemini
- Anthropic Claude
- LMArena
- Perplexity
- X.ai Grok
- DeepSeek

## Downloading the App for Personal Use

Go to the Releases section, and download the Setup.exe. It is going to say that Microsoft has flagged this as untrusted. Windows codesigning has not
been done yet, so for now, ignore the warning and proceed to installation.

The app should open immediately after you bypass the warning and you can add the desktop shortcut to your computer!

## How to Use the App

### Selecting the Model

Use the dropdown at the bottom right corner to add and remove LLM web consoles. By default, ChatGPT, Gemini, and Llama are there by default and cannot be changed.

\*Note that if you are on free tier, then you will face the typical usage limits as specified by the LLM provider.

To launch the prompt to all the LLM's, press Ctrl + Enter on your keyboard

If you want to close the app, press Ctrl + W on your keyboard.

### Custom styling (no browser extensions required)

LLM-God now ships with an optional `custom-styles.json` file that lives next to the app's settings inside Electron's user data folder (for example `%APPDATA%/llm-god/custom-styles.json` on Windows). Each entry in that file contains a regular-expression `match` string and the raw CSS that should be injected into any embedded browser tab whose URL matches the expression. You can use aliases such as `"@llms"` to target every bundled LLM domain at once, but the default configuration now demonstrates per-site overrides with the dedicated aliases (`"@chatgpt"`, `"@gemini"`, `"@perplexity"`, `"@claude"`, `"@grok"`, `"@deepseek"`, and `"@lmarena"`) so you can tailor selectors without needing Stylus or any other extension.

```jsonc
{
  "styles": [
    {
      "match": "@chatgpt",
      "css": "/* Example: tint headings on all bundled LLM tabs */\n      h1, h2, h3, h4, h5, h6, strong, b, .font-semibold, [class*=\"font-bold\"] { color: #58aefd !important; }"
    },
    {
      "match": "@gemini",
      "css": "/* Example: tint headings on all bundled LLM tabs */\n      h1, h2, h3, h4, h5, h6, strong, b { color: #58aefd !important; }"
    },
    {
      "match": "perplexity.ai",
      "css": "body { font-family: 'Fira Code', monospace; }"
    }
  ]
}
```

The JSON file is re-read whenever it changes, so you can keep the app running while experimenting with new CSS snippets. Invalid regular expressions are ignored and reported to the console in the Electron main process; unknown aliases are also logged so you can fix any typos.

### Dark mode defaults

LLM-God forces the embedded Chromium engine into dark mode, so each LLM website sees `prefers-color-scheme: dark` and automatically renders its dark theme when available.

## Disclaimer

I did find out about the [GodMode](https://github.com/smol-ai/GodMode) project, but I felt that people needed an app that just provided the models from the few big companies like OpenAI and Anthropic. Many of the other smaller models are not very useful. In addition, that project doesn't seem to be very well maintained anymore and doesn't have some of the new models like Grok.

## Contributing

New contributions are welcome!

1. Clone the project and navigate to root directory

```
git clone https://github.com/czhou578/llm-god.git
cd llm-god
```

2. Install all dependencies

```
npm install
```

3. Start the app, which will create the shortcut that will also appear on your computer

```
npm run start
```

When developing, instead of running the command above, I like to have two terminals open. One terminal should run the command:

```
npx tsc --watch
```

and the other terminal should run the command:

```
npx electronmon dist/main.js
```

4. To check if the build works properly, run the following command in the root folder

```
npm run make
```

This will create a launchable app in the `/out/app-win32-x64` path. You can then add this to your task bar for daily use outside of development!

## Debugging Tools

While developing, I liked to have the devtools of the app be visible and also have the option to have hot reloading on every save. Uncomment the following two lines to do so:

```
 mainWindow.webContents.openDevTools({ mode: "detach" });
 require("electron-reload")(path.join(__dirname, "."));
```

Please check out the Issues tab for existing issues to tackle, and feel free to suggest new issues as well! Make a pull request to this repo once a feature or bug fix is done.

## Updates

5/17: Migrated to using TypeScript across the app.
6/15: Added support for LMArena and also for adding custom prompts that can be saved.
