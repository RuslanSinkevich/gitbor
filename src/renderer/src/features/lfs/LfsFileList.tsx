import s from './LfsDialog.module.css';

interface LfsFile { name: string; size: string; oid: string; }

interface Props {
  files: LfsFile[];
  labels: { files: string; noFiles: string };
}

/** List of files currently managed by Git LFS. */
export function LfsFileList({ files, labels }: Props) {
  return (
    <div className={s.section}>
      <span className={s.sectionTitle}>{labels.files} ({files.length})</span>
      {files.length === 0 ? (
        <span className={s.noItems}>{labels.noFiles}</span>
      ) : (
        files.map((f) => (
          <div key={f.name} className={s.fileItem}>
            <span className={s.fileName}>{f.name}</span>
            <span className={s.fileOid}>{f.oid}</span>
          </div>
        ))
      )}
    </div>
  );
}
