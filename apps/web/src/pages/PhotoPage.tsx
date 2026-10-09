import { detectKind } from '../lib/detectKind';
import { getSelectedFile } from '../lib/selectedFile';
import { PhotoTool } from '../photo/PhotoTool';

export function PhotoPage() {
  const selected = getSelectedFile();
  const initialFile = selected && detectKind(selected).kind === 'image' ? selected : null;
  return <PhotoTool initialFile={initialFile} />;
}
