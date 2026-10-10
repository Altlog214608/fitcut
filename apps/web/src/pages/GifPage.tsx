import { GifTool } from '../gif/GifTool';
import { detectKind } from '../lib/detectKind';
import { getSelectedFile } from '../lib/selectedFile';

export function GifPage() {
  const selected = getSelectedFile();
  const initialFile = selected && detectKind(selected).kind === 'video' ? selected : null;
  return <GifTool initialFile={initialFile} />;
}
