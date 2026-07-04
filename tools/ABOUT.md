`tools/` contains repo utilities that are separate from the main website experience.

There are two kinds of things here:

- standalone hosted tools, usually in their own subdirectory and served at a `/tools/...` route
- local maintenance/build scripts used to support the repo

Subdirectories in `tools/` should generally be treated as self-contained utilities rather than core site features. For example, `tools/image-upload/` is a standalone uploader that the site hosts, but it is not part of the primary Anime Lighthouse browsing/submission flow.

As a rule of thumb:

- if the change is for a standalone utility page, it likely belongs in `tools/`
- if the change is for the core website UX or data flow, it likely belongs elsewhere in the repo
