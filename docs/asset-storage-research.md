# Owlbear Audio Asset Storage Research

Updated: 2026-09-09

## Goal
Remove or greatly reduce the second Asset picker after upload. The first folder picker is acceptable because users may intentionally choose the dedicated Audio Folder.

## Branch A: raw upload RPC response
Public OBR.assets.uploadImages() returns Promise<void>, but internally the SDK uses MessageBus.sendAsync. Test whether OBR_ASSETS_UPLOAD_IMAGES_RESPONSE_* contains an asset id, ImageContent, URL, or another stable locator that the public wrapper discards. Inspect raw postMessage / internal messageBus and, if needed, DevTools Network. Treat this as experimental and not a production dependency until stability is proven.

## Branch B: dedicated Audio Folder + bulk re-index
Assume users create one dedicated Audio Folder and all plugin-managed audio lives there. Give each upload a stable machine-readable prefix/batch id. Use downloadImages(true, defaultSearch, typeHint) and test whether the picker can select all items in the current folder/search result. The plugin can then rebuild its index from returned ImageDownload.name + image.url instead of asking the user to identify visually identical black thumbnails. Also test large-folder limits, pagination/virtualization, and whether any undocumented folder filter exists.

## Branch C: Scene Item as a public-API bridge
A selected Owlbear IMAGE scene item contains ImageContent including url/mime/width/height. Context-menu callbacks receive the selected Item[]. Therefore once an Asset is instantiated as a PROP/IMAGE on the scene, the extension can read item.image.url directly without downloadImages(). Test multi-select context-menu registration, scanning scene images with OBR.scene.items.getItems(isImage), metadata tagging, and a temporary import area where users can drag many Audio Folder assets once, then bulk-register and optionally delete the temporary items.

## Priority
1. Verify the Scene Item/context-menu URL bridge and bulk selection.
2. Verify Audio Folder search/full-selection re-index.
3. Open an isolated experiment branch for the raw upload RPC response.
4. Consider private REST APIs/external object storage only if the public routes are insufficient.
