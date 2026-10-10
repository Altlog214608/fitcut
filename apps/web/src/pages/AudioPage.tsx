import { AudioTool } from '../audio/AudioTool';
import { detectKind } from '../lib/detectKind';
import { getSelectedFile } from '../lib/selectedFile';

export function AudioPage() {
  const selected = getSelectedFile();
  const kind = selected ? detectKind(selected).kind : null;
  const initialFile = selected && (kind === 'audio' || kind === 'video') ? selected : null;
  return <AudioTool initialFile={initialFile} />;
}
