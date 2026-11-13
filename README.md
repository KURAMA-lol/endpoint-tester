# Endpoint Tester

Minimal liquid-glass chat UI for testing any LLM endpoint:

- **OpenAI-compatible** (OpenAI, Groq, Together, Fireworks, Ollama, LM Studio, vLLM, proxies…)
- **Google Gemini**
- **Keyless / custom** endpoints

Pure static PWA — no build step, no dependencies. Installable on Android/iOS like a native app.

## Features

- Dark & light themes (auto + toggle)
- Streaming & non-streaming
- System prompt, temperature, max tokens, extra headers
- Settings persisted in localStorage
- Connection test
- Mobile-friendly drawer + PWA install

## Live / Install

1. Open the GitHub Pages URL (or open `index.html` locally).
2. On Android Chrome: menu → **Add to Home screen** / **Install app**.
3. It runs fullscreen like a native app.

## Deploy

```bash
# after cloning or creating the repo
# enable GitHub Pages: Settings → Pages → Deploy from branch → main / (root)
```

## Providers

| Type              | Base URL example                                      | Key        |
|-------------------|-------------------------------------------------------|------------|
| OpenAI            | `https://api.openai.com/v1`                           | required   |
| Groq              | `https://api.groq.com/openai/v1`                      | required   |
| Ollama (local)    | `http://localhost:11434/v1`                           | optional   |
| LM Studio         | `http://localhost:1234/v1`                            | optional   |
| Gemini            | `https://generativelanguage.googleapis.com/v1beta`    | required   |

**CORS:** Browsers enforce CORS. Many cloud providers allow it; local servers often need CORS enabled.

## License

MIT
