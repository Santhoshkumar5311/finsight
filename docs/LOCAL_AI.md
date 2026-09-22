# Local AI and Prime Agent

FinSight can use Ollama for local text chat without OpenAI credentials. Install Ollama, then:

```sh
OLLAMA_HOST=127.0.0.1:11434 ollama serve
ollama pull qwen3:8b
```

Set `LOCAL_AI_ENABLED=true`, `LOCAL_AI_URL=http://127.0.0.1:11434`, and `LOCAL_AI_MODEL=qwen3:8b` in the private root `.env`, then restart FinSight. Only an HTTP loopback endpoint is accepted. The adapter has bounded tool rounds, validated responses and an allowlist of financial functions. It supplies financial aggregates and redacted chat text, not original statements, login secrets or account numbers. Cloud AI is disabled in local mode; audio transcription remains unavailable offline. Initial loading and full responses can take several seconds; deterministic affordability arithmetic bypasses the model.

Prime Agent is a separate coding tool, not the FinSight financial assistant. It is optional. The local installation is under `.data/prime/runtime`, with `.data/prime/bin/prime-agent` as its launcher. To recreate it, inspect the official installer at https://app.primeintellect.ai/prime-agent/install.sh and set its `PRIME_AGENT_INSTALL_DIR`/`PRIME_AGENT_BIN_DIR` to those absolute locations before running it. Installation downloads executable code and a Python runtime.

Run `npm run prime:local` for a tools-disabled local-model session. The wrapper uses an empty disposable working directory, its own model configuration, no context-file/extension/skill discovery, and no saved session. Use synthetic prompts or nonsensitive code snippets. It neither loads the FinSight `.env` nor copies statement files. `--offline` disables startup network operations, not every possible network operation. The wrapper pins inference to loopback.

The official project states that its Python execution and shell commands run with your OS user's permissions, not a security sandbox: https://github.com/PrimeIntellect-ai/prime-agent . Do not enable coding tools against the personal finance workspace. For autonomous coding, use a separate OS account/container with a source-only checkout, synthetic fixtures, no host home mount, no banking credentials, and network restrictions. This setup does not launch autonomous subagents or give Prime banking tools.
