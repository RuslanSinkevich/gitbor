import { useState } from 'react';

/** All dialog visibility states managed in one place. */
export interface DialogStates {
  showAbout: boolean;
  showSshKeys: boolean;
  showRepoSettings: boolean;
  showReflog: boolean;
  showBisect: boolean;
  showHooks: boolean;
  showWorktrees: boolean;
  showLfs: boolean;
}

export interface DialogActions {
  setShowAbout: (v: boolean) => void;
  setShowSshKeys: (v: boolean) => void;
  setShowRepoSettings: (v: boolean) => void;
  setShowReflog: (v: boolean) => void;
  setShowBisect: (v: boolean) => void;
  setShowHooks: (v: boolean) => void;
  setShowWorktrees: (v: boolean) => void;
  setShowLfs: (v: boolean) => void;
}

/**
 * Centralizes all dialog open/close state to reduce
 * boilerplate in App.tsx.
 */
export function useDialogs(): DialogStates & DialogActions {
  const [showAbout, setShowAbout] = useState(false);
  const [showSshKeys, setShowSshKeys] = useState(false);
  const [showRepoSettings, setShowRepoSettings] = useState(false);
  const [showReflog, setShowReflog] = useState(false);
  const [showBisect, setShowBisect] = useState(false);
  const [showHooks, setShowHooks] = useState(false);
  const [showWorktrees, setShowWorktrees] = useState(false);
  const [showLfs, setShowLfs] = useState(false);

  return {
    showAbout, setShowAbout,
    showSshKeys, setShowSshKeys,
    showRepoSettings, setShowRepoSettings,
    showReflog, setShowReflog,
    showBisect, setShowBisect,
    showHooks, setShowHooks,
    showWorktrees, setShowWorktrees,
    showLfs, setShowLfs,
  };
}
