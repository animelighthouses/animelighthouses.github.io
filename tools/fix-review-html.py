from pathlib import Path

p = Path(__file__).resolve().parent.parent / "review.html"
lines = p.read_text(encoding="utf-8").splitlines()
out = []
skip = 0
for line in lines:
    if skip:
        skip -= 1
        continue
    if 'id="storedImagePreview"' in line and "hidden" in line:
        skip = 3
        continue
    out.append(line)

text = "\n".join(out) + "\n"

if "reviewFormBody" not in text:
    text = text.replace(
        "</select>\n                    </div>\n                </div>\n\n                <motion class=\"section\">".replace(
            "motion", "div"
        ),
        "</select>\n                    </div>\n                </div>\n\n                <div id=\"reviewFormBody\" hidden>\n\n                <div class=\"section\">",
        1,
    )

if "reviewAdvancedFields" not in text:
    text = text.replace(
        '                <div class="section">\n                    <div class="field">\n                        <label>Date spotted *</label>',
        '                <div id="reviewAdvancedFields" hidden>\n                <div class="section">\n                    <div class="field">\n                        <label>Date spotted *</label>',
        1,
    )
    text = text.replace(
        '                <div id="lighthouseSection">',
        '                </div>\n\n                <div id="lighthouseSection">',
        1,
    )

text = text.replace(
    '<button type="submit">Save changes</button>',
    '<button type="button" id="rejectBtn">Reject</button>\n'
    '                    <button type="button" id="approveBtn" disabled>Approve</button>',
)
text = text.replace("edit-sighting.js", "review-submission.js")

if 'id="reviewFormBody"' in text:
    text = text.replace(
        '                <div class="btn-row">',
        '                </motion>\n\n                <div class="btn-row">'.replace("motion", "div"),
        1,
    )

p.write_text(text, encoding="utf-8", newline="\n")
print("ok")
