/** About dialog: version and the BSD-3 notice for the shipped Modelica Standard Library subset. */
import { Dialog } from '../../common/Dialog';
import { Logo } from '../Logo';
import { APP_NAME, APP_VERSION } from '../shellActions';
import '../shell.css';

const MSL_NOTICE = `The Modelica library shipped with this application is a subset of the Modelica Standard Library (MSL) 4.0.0, adapted to the Modelica subset supported by this platform.

Copyright (c) 1998-2020, Modelica Association and contributors. All rights reserved.

The Modelica Standard Library is licensed by the Modelica Association under the 3-Clause BSD License; the same license applies to the adapted subset (see libraries/Modelica/LICENSE.md). Redistribution and use in source and binary forms, with or without modification, are permitted provided that the conditions of the license are met. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.

Modelon and Modelon Impact are trademarks of Modelon AB. This clone is an independent open-source project and is not affiliated with or endorsed by Modelon.`;

export function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open title="About" onClose={onClose} width={520} className="about-dialog" actions={<button type="button" className="contained-button" onClick={onClose}>Close</button>}>
      <div className="about-head">
        <Logo size={40} />
        <div>
          <div className="about-title">{APP_NAME}</div>
          <div className="about-version">Version {APP_VERSION} · MIT License</div>
        </div>
      </div>
      <p>A browser-based Modelica system modeling and simulation platform: Modelica text is the single source of truth, the diagram editor edits that text through graphical annotations, the built-in compiler flattens models into a DAE, and the numerical solver simulates them in the browser.</p>
      <p className="form-label">Third-party notice — Modelica Standard Library</p>
      <div className="license">{MSL_NOTICE}</div>
    </Dialog>
  );
}

export default AboutDialog;
