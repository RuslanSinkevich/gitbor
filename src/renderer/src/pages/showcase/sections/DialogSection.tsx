import { useState } from 'react';
import { SgButton, SgDialog, SgCheckbox } from '../../../ui';
import { t } from '../../../i18n';

export function DialogSection() {
  const loc = t();
  const [open, setOpen] = useState(false);
  return (
    <div className="sg-showcase-section">
      <SgButton onClick={() => setOpen(true)}>{loc.showcase.dialog}</SgButton>
      <SgDialog
        open={open}
        title={loc.dialog.deleteBranchTitle.replace('{branch}', 'feature/old')}
        onClose={() => setOpen(false)}
        footer={
          <>
            <SgButton variant="secondary" onClick={() => setOpen(false)}>{loc.dialog.cancel}</SgButton>
            <SgButton variant="danger" onClick={() => setOpen(false)}>{loc.dialog.delete}</SgButton>
          </>
        }
      >
        <p>{loc.dialog.deleteBranchMessage}</p>
        <div style={{ marginTop: 12 }}>
          <SgCheckbox label={loc.dialog.deleteOnRemote.replace('{upstream}', 'origin/feature/old')} />
        </div>
      </SgDialog>
    </div>
  );
}
