# Your personas

Built-in personas (james, margaret, priya, tomasz, chaos) work without any files here.

- **Override a built-in:** create `james.yaml` with `id: james`, `extends: james` and only the fields that differ.
- **Variant:** `id: james-android`, `extends: james`, then change `environment`.
- **New persona:** `/personaqa:persona new "night shift nurse on an Android tablet"`.

Check your files with `/personaqa:validate`. Keep traits about behaviour (patience, reading, device), never stereotypes.
