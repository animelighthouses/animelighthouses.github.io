from pathlib import Path

p = Path(__file__).resolve().parent.parent / "review.html"
t = p.read_text(encoding="utf-8")

anilist_block = """                <div class="section">
                    <motion class="field">
                        <label>AniList link</label>
                        <div class="anilist-row">
                            <input name="anilist_link" id="anilistInput" type="url" />
                            <button type="button" id="anilistFetchBtn">Fetch</button>
                        </div>
                    </div>
                </motion>

""".replace("<motion", "<div").replace("</motion>", "</div>")

if t.count(anilist_block) == 1:
    t = t.replace(anilist_block, "", 1)
    t = t.replace(
        '<div id="reviewAdvancedFields" hidden>\n',
        '<motion id="reviewBasicFields">\n' + anilist_block + '</motion>\n<div id="reviewAdvancedFields" hidden>\n'.replace(
            "motion", "div"
        ),
        1,
    )

# Put lighthouse inside advanced (before its closing div)
t = t.replace(
    "\n                </div>\n\n                <div id=\"lighthouseSection\">",
    "\n                <div id=\"lighthouseSection\">",
    1,
)
# Close advanced after lighthouse
t = t.replace(
    """                <div id="lighthouseSection">
                    <div class="field">
                        <label>Lighthouse</label>
                        <select name="lighthouse_id" id="lighthouseSelect">
                            <option value="">-- Select lighthouse --</option>
                        </select>
                    </div>
                </div>

                <div class="section">
                    <div class="field">
                        <label>Notes</label>""",
    """                <motion id="lighthouseSection">
                    <div class="field">
                        <label>Lighthouse</label>
                        <select name="lighthouse_id" id="lighthouseSelect">
                            <option value="">-- Select lighthouse --</option>
                        </select>
                    </div>
                </div>
                </div>

                <div class="section">
                    <div class="field">
                        <label>Notes</label>""".replace("motion", "motion"),
    1,
)
t = t.replace("<motion", "<div").replace("</motion>", "</div>")

p.write_text(t, encoding="utf-8", newline="\n")
print("ok")
