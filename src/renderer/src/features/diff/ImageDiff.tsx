import s from './DiffView.module.css';

interface Props {
  file: string;
  hash: string;
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico']);

export function isImageFile(path: string): boolean {
  const ext = path.substring(path.lastIndexOf('.')).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

export function ImageDiff({ file }: Props) {
  return (
    <div className={s.root}>
      <div className={s.toolbar}>
        <span className={s.filePath}>{file}</span>
      </div>
      <div className={s.empty}>
        Image diff preview is not yet supported. The file is a binary image.
      </div>
    </div>
  );
}
