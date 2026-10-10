import { detectKind } from '../lib/detectKind';
import { getSelectedFile } from '../lib/selectedFile';
import { RotateTool } from '../rotate/RotateTool';

export function RotatePage() {
  const selected = getSelectedFile();
  const initialFile = selected && detectKind(selected).kind === 'video' ? selected : null;
  return <RotateTool initialFile={initialFile} />;
}
