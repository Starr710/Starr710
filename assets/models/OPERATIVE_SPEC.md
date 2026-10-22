# Lead operative: character brief (Phase 1A)

An original female special-operations soldier, styled after the WWII era and the 1960s. The mood draws on classic handheld stealth games, but she is **not** a copy of any existing character.

## Look
- **Age / build:** woman of about 28–29. Athletic, grounded build with a believable weight stance: average height, strong legs and shoulders, not waif-thin.
- **Face / hair:** a recognizable human face. Short, swept-back blonde hair. Calm, focused expression.
- **Base layer:** black turtleneck.
- **Outer suit:** olive drab one-piece field suit with cuffed sleeves.
- **Webbing:** black canvas chest harness with suspender straps that drop to the belt (Y-harness), and a pistol belt with pouches and a holster.
- **Knife:** a combat knife in a sheath worn high on the left shoulder strap.
- **Gloves / boots:** dark leather gloves and laced combat boots.
- **Poncho:** a **black hooded poncho** over the suit. Hood up for stealth, down for review. It falls to mid-thigh.

## Technical targets (iPhone Safari)
- About 15–25k triangles including clothing. At most 3 materials and 1024² textures, with 512² as the low-tier fallback.
- Skeleton: 65-bone game rig with Mixamo bone names (`mixamorig*`), so Mixamo clips (idle, walk, crouch, prone, crawl, aim) retarget directly. Plus a `WeaponR` socket.
- Poncho and hood are skinned to the spine, shoulders and head, with no cloth simulation.

## Generator parameters (Ara 3D Gen, MakeHuman CC0 data)
`operative.params.json` in this folder. The poncho and hood are not in the MakeHuman library and will be modelled as a custom skinned garment.
