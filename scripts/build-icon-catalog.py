import os
import re

SVG_DIR = r"D:\Game Tools and Assets\icons\phosphor\SVGs Flat\duotone"
REPO_DIR = r"C:\Projects\Repos\Rook"
PHOSPHOR_DATA_PATH = os.path.join(REPO_DIR, "src", "components", "phosphorIconsData.ts")
ICON_CATALOG_PATH = os.path.join(REPO_DIR, "src", "components", "iconCatalog.ts")

# Read existing phosphorIconsData.ts line by line to preserve ALL existing keys
existing_entries = {}
if os.path.exists(PHOSPHOR_DATA_PATH):
    with open(PHOSPHOR_DATA_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("'") and "': '" in line:
                idx = line.find("': '")
                k = line[1:idx]
                v = line[idx + 4 :]
                if v.endswith("',"):
                    v = v[:-2]
                elif v.endswith("'"):
                    v = v[:-1]
                existing_entries[k] = v

print(f"Loaded {len(existing_entries)} existing entries.")

# Curated catalog definitions: category -> list of phosphor filenames (without -duotone.svg) or custom IDs
CURATED_CATEGORIES = {
    "folders": {
        "label": "Folders & Places",
        "icon": "folder",
        "icons": [
            ("folder", "Folder"),
            ("folder-open", "Open Folder"),
            ("folder-star", "Starred Folder"),
            ("folder-user", "User Folder"),
            ("folder-lock", "Locked Folder"),
            ("folder-simple", "Simple Folder"),
            ("folder-dashed", "Dashed Folder"),
            ("folders", "Folders Stack"),
            ("pouch", "Classic Pouch"),
            ("house", "Home"),
            ("house-line", "House Line"),
            ("buildings", "Buildings"),
            ("storefront", "Storefront"),
            ("map-pin", "Map Pin"),
            ("compass", "Compass"),
            ("navigation-arrow", "Navigation"),
            ("planet", "Planet"),
            ("globe", "Globe"),
            ("globe-hemisphere-west", "World"),
            ("cloud", "Cloud"),
            ("cloud-arrow-up", "Cloud Upload"),
            ("cloud-arrow-down", "Cloud Download"),
            ("hard-drive", "Hard Drive"),
            ("hard-drives", "Storage Array"),
            ("floppy-disk", "Floppy Disk"),
            ("database", "Database"),
            ("desktop", "Desktop PC"),
            ("laptop", "Laptop"),
            ("device-mobile", "Mobile Phone"),
            ("devices", "Multiple Devices"),
        ]
    },
    "dev": {
        "label": "Code & Tech",
        "icon": "terminal",
        "icons": [
            ("terminal", "Terminal"),
            ("terminal-window", "Terminal Window"),
            ("code", "Code"),
            ("code-block", "Code Block"),
            ("code-simple", "Code Brackets"),
            ("git-branch", "Git Branch"),
            ("git-commit", "Git Commit"),
            ("git-diff", "Git Diff"),
            ("git-fork", "Git Fork"),
            ("git-merge", "Git Merge"),
            ("git-pull-request", "Pull Request"),
            ("cpu", "Processor / CPU"),
            ("brackets-curly", "Curly Brackets"),
            ("brackets-angle", "Angle Brackets"),
            ("bug", "Bug"),
            ("bug-droid", "Android Bug"),
            ("robot", "Robot"),
            ("atom", "Atom / React"),
            ("wrench", "Wrench"),
            ("gear", "Settings Gear"),
            ("gear-fine", "Fine Gear"),
            ("gear-six", "Six Tooth Gear"),
            ("lightning", "Lightning Bolt"),
            ("plug", "Power Plug"),
            ("shield", "Shield"),
            ("shield-check", "Shield Check"),
            ("shield-star", "Shield Star"),
            ("key", "Security Key"),
            ("lock", "Padlock"),
            ("lock-key", "Keyhole Lock"),
            ("lock-open", "Unlocked"),
            ("fingerprint", "Fingerprint"),
            ("broadcast", "Broadcast"),
            ("wifi-high", "Wi-Fi"),
            ("bluetooth", "Bluetooth"),
            ("battery-charging", "Battery"),
            ("sublime", "Sublime Text"),
            ("notepadpp", "Notepad++"),
            ("file_ts", "TypeScript"),
            ("file_py", "Python"),
            ("file_cs", "C#"),
            ("file_cpp", "C++"),
            ("file_html", "HTML5"),
            ("file_css", "CSS3"),
            ("file_sql", "SQL Database"),
        ]
    },
    "media": {
        "label": "Media & Design",
        "icon": "image",
        "icons": [
            ("image", "Image"),
            ("images", "Image Gallery"),
            ("image-square", "Square Picture"),
            ("camera", "Camera"),
            ("video-camera", "Video Camera"),
            ("film", "Film"),
            ("film-slate", "Clapperboard"),
            ("film-strip", "Film Strip"),
            ("film-reel", "Film Reel"),
            ("musicOn", "Audio Speaker"),
            ("music-notes", "Music Notes"),
            ("music-note", "Music Note"),
            ("headphones", "Headphones"),
            ("microphone", "Microphone"),
            ("speaker-high", "High Volume"),
            ("palette", "Art Palette"),
            ("paint-brush", "Paint Brush"),
            ("paint-bucket", "Paint Bucket"),
            ("pen", "Ink Pen"),
            ("pencil", "Pencil"),
            ("pencil-simple", "Simple Pencil"),
            ("crop", "Crop Tool"),
            ("eyedropper", "Eyedropper"),
            ("magic-wand", "Magic Wand"),
            ("sparkle", "Sparkle"),
            ("sun", "Sun"),
            ("moon", "Moon"),
        ]
    },
    "work": {
        "label": "Projects & Office",
        "icon": "briefcase",
        "icons": [
            ("book", "Book"),
            ("book-open", "Open Book"),
            ("book-bookmark", "Book with Bookmark"),
            ("books", "Books Stack"),
            ("notebook", "Notebook"),
            ("notepad", "Notepad"),
            ("newspaper", "Newspaper"),
            ("article", "Article"),
            ("archive", "Archive Box"),
            ("package", "Package / Box"),
            ("cube", "3D Cube"),
            ("tray", "Inbox Tray"),
            ("cards", "Cards"),
            ("bookmark", "Bookmark Ribbon"),
            ("bookmark-simple", "Simple Bookmark"),
            ("tag", "Price Tag"),
            ("tag-simple", "Simple Tag"),
            ("paperclip", "Paperclip"),
            ("push-pin", "Push Pin"),
            ("clipboard", "Clipboard"),
            ("clipboard-text", "Clipboard Note"),
            ("list-bullets", "Bullet List"),
            ("check-square", "Checklist"),
            ("calendar", "Calendar"),
            ("calendar-check", "Calendar Event"),
            ("calendar-blank", "Clean Calendar"),
            ("clock", "Clock"),
            ("timer", "Timer"),
            ("hourglass", "Hourglass"),
            ("bell", "Notification Bell"),
            ("bell-ringing", "Ringing Bell"),
            ("chart-bar", "Bar Chart"),
            ("chart-line", "Trend Line"),
            ("chart-pie", "Pie Chart"),
            ("briefcase", "Briefcase"),
            ("credit-card", "Credit Card"),
            ("wallet", "Wallet"),
            ("currency-dollar", "Dollar Currency"),
            ("coins", "Coins"),
            ("bank", "Bank Vault"),
            ("receipt", "Receipt"),
        ]
    },
    "fun": {
        "label": "Gaming & Chess",
        "icon": "crown",
        "icons": [
            ("chess_rook", "Chess Rook"),
            ("crown", "Royal Crown"),
            ("crown-simple", "Simple Crown"),
            ("game-controller", "Gamepad"),
            ("gameController", "Retro Controller"),
            ("sword", "Sword"),
            ("shield-chevron", "Knight Shield"),
            ("trophy", "Trophy"),
            ("medal", "Medal"),
            ("award", "Award Star"),
            ("flag", "Flag"),
            ("flag-banner", "Pennant Flag"),
            ("fire", "Fire"),
            ("flame", "Flame"),
            ("campfire", "Campfire"),
            ("skull", "Skull"),
            ("ghost", "Ghost"),
            ("diamond", "Diamond Gem"),
            ("heart", "Heart"),
            ("heart-straight", "Pixel Heart"),
            ("dice-five", "Dice"),
            ("target", "Target Bullseye"),
            ("crosshair", "Crosshair Aim"),
            ("coffee", "Coffee Mug"),
            ("pizza", "Pizza Slice"),
            ("beer-bottle", "Beer Bottle"),
            ("wine", "Wine Glass"),
            ("cake", "Birthday Cake"),
            ("cookie", "Cookie"),
            ("hamburger", "Burger"),
            ("paw-print", "Animal Paw"),
            ("cat", "Cat"),
            ("dog", "Dog"),
            ("bird", "Bird"),
            ("fish", "Fish"),
            ("tree", "Tree"),
            ("leaf", "Leaf"),
            ("flower", "Flower"),
            ("rocket", "Space Rocket"),
            ("alien", "Alien"),
            ("meteor", "Meteor"),
        ]
    },
    "symbols": {
        "label": "Badges & UI",
        "icon": "squares-four",
        "icons": [
            ("squares-four", "Four Squares"),
            ("grid-four", "Grid View"),
            ("columns", "Columns"),
            ("rows", "Rows"),
            ("barsVertical", "Vertical Bars"),
            ("barsHorizontal", "Horizontal Bars"),
            ("scrollHorizontal", "Dual Split"),
            ("menuGrid", "Menu Grid"),
            ("sidebar", "Sidebar"),
            ("sidebar-simple", "Simple Sidebar"),
            ("tabs", "Tabbed Windows"),
            ("split-horizontal", "Split Horizontal"),
            ("split-vertical", "Split Vertical"),
            ("arrows-split", "Split Arrows"),
            ("arrows-merge", "Merge Arrows"),
            ("shuffle", "Shuffle"),
            ("repeat", "Repeat"),
            ("sliders", "Adjustment Sliders"),
            ("funnel", "Filter Funnel"),
            ("eye", "Visible Eye"),
            ("eye-slash", "Hidden Eye"),
            ("zoom", "Search Loupe"),
            ("zoomIn", "Zoom In"),
            ("magnifying-glass", "Magnifying Glass"),
            ("lightbulb", "Idea Lightbulb"),
            ("flashlight", "Flashlight"),
            ("binoculars", "Binoculars"),
            ("magnet", "Magnet"),
            ("scales", "Balance Scales"),
            ("check-circle", "Circle Check"),
            ("warning-circle", "Circle Warning"),
            ("info", "Information"),
            ("question", "Help Question"),
            ("star", "Favorite Star"),
            ("save", "Save Disk"),
            ("export", "Export Out"),
            ("import", "Import In"),
        ]
    }
}

new_entries = dict(existing_entries)
catalog_items = []

for cat_id, cat_info in CURATED_CATEGORIES.items():
    for icon_id, icon_label in cat_info["icons"]:
        clean_id = icon_id
        if clean_id not in new_entries:
            cand_filenames = [
                f"{icon_id}-duotone.svg",
                f"{icon_id}.svg",
            ]
            svg_content = None
            for fname in cand_filenames:
                fpath = os.path.join(SVG_DIR, fname)
                if os.path.exists(fpath):
                    with open(fpath, "r", encoding="utf-8") as sf:
                        svg_content = sf.read()
                    break

            if svg_content:
                m = re.search(r"<svg[^>]*>(.*?)</svg>", svg_content, re.DOTALL)
                if m:
                    inner = m.group(1).strip()
                    inner = inner.replace("\n", "").replace("\r", "")
                    inner = re.sub(r">\s+<", "><", inner)
                    new_entries[clean_id] = inner
                    if "-" in clean_id:
                        camel = re.sub(r"-([a-z])", lambda match: match.group(1).upper(), clean_id)
                        new_entries[camel] = inner
                        underscore = clean_id.replace("-", "_")
                        new_entries[underscore] = inner
            else:
                print(f"Warning: icon not found: {icon_id}")

        catalog_items.append({
            "id": clean_id,
            "label": icon_label,
            "category": cat_id
        })

print(f"Total entries in phosphorIconsData: {len(new_entries)}")
print(f"Total items in icon catalog: {len(catalog_items)}")

# Write phosphorIconsData.ts
with open(PHOSPHOR_DATA_PATH, "w", encoding="utf-8") as f:
    f.write("// Auto-generated phosphor icons dataset\n")
    f.write("export const PHOSPHOR_SVG_INNER: Record<string, string> = {\n")
    for k in sorted(new_entries.keys()):
        val = new_entries[k]
        val_escaped = val.replace("'", "\\'")
        f.write(f"  '{k}': '{val_escaped}',\n")
    f.write("};\n")

# Write iconCatalog.ts
with open(ICON_CATALOG_PATH, "w", encoding="utf-8") as f:
    f.write("// Comprehensive curated icon catalog for Quick Access & Workflows\n\n")
    f.write("export interface IconCatalogItem {\n")
    f.write("  id: string;\n")
    f.write("  label: string;\n")
    f.write("  category: 'folders' | 'dev' | 'media' | 'work' | 'fun' | 'symbols';\n")
    f.write("}\n\n")
    f.write("export interface IconCategory {\n")
    f.write("  id: 'all' | 'folders' | 'dev' | 'media' | 'work' | 'fun' | 'symbols';\n")
    f.write("  label: string;\n")
    f.write("  icon: string;\n")
    f.write("}\n\n")
    f.write("export const ICON_CATEGORIES: IconCategory[] = [\n")
    f.write("  { id: 'all', label: 'All', icon: 'squares-four' },\n")
    for cat_id, cat_info in CURATED_CATEGORIES.items():
        f.write(f"  {{ id: '{cat_id}', label: '{cat_info['label']}', icon: '{cat_info['icon']}' }},\n")
    f.write("];\n\n")

    f.write("export const ICON_CATALOG: IconCatalogItem[] = [\n")
    for item in catalog_items:
        f.write(f"  {{ id: '{item['id']}', label: '{item['label']}', category: '{item['category']}' }},\n")
    f.write("];\n")

print("Done! Updated phosphorIconsData.ts and iconCatalog.ts successfully.")
