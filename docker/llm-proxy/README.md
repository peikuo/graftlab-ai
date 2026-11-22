# LLM_Proxy container

The only holder of the real LLM key. Containers on the internal network call it with a per-Task credential; it replaces the credential with the real key and forwards only allowed paths. The entry point lives in `apps/server/src/proxy/` and runs on the dev-sandbox image.

Placeholder from milestone 2.
