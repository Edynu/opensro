"""Republish only existing native-window RGB16 textures; called by the pack refresh."""
from pathlib import Path
import json
import sys
from io import BytesIO
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from convert_images import GAME_ROOT, REPO_ROOT, decode_native_rgb16, extract_ddj_payload
from rebuild_lock import generated_assets_lock

with generated_assets_lock('Native window RGB16 expansion'):
    changed = []
    public = REPO_ROOT / '.generated/client-public'
    for family in ('frame', 'ifcommon', 'system', 'messagebox', 'inventory', 'equipment', 'mainpopup', 'character', 'party', 'option', 'alchemy', 'guild', 'pet', 'icon'):
        source_root = GAME_ROOT / 'extracted/Media_extracted' / ('icon' if family == 'icon' else 'interface/' + family)
        for source in sorted(source_root.glob('**/*.ddj')):
            if family == 'icon' and source.stem not in ('icon_disable', 'icon_item_broken', 'icon_item_warning'):
                continue
            relative = source.relative_to(GAME_ROOT / 'extracted').with_suffix('.png')
            target = public / 'assets/images' / relative
            # 5B4C30/620450/620180 create these controls outside resinfo.
            dynamic = (family in ('alchemy', 'icon') or source.stem.startswith('com_short_tab_'))
            if not target.exists() and not dynamic:
                continue
            payload = extract_ddj_payload(source)
            image = decode_native_rgb16(payload)
            if image is None and dynamic:
                image = Image.open(BytesIO(payload))
            if image is None:
                continue
            data = BytesIO();image.save(data, 'PNG');content = data.getvalue()
            # Include corrected files on repeat runs so an interrupted pack refresh recovers.
            for destination in (REPO_ROOT / 'assets/images' / relative, target):
                if not destination.exists() or destination.read_bytes() != content:
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    temporary = destination.with_suffix('.png.native-window-tmp')
                    temporary.write_bytes(content);temporary.replace(destination)
            changed.append('/' + target.relative_to(public).as_posix())
    print(json.dumps(changed))
