/** The "?" overlay: every Watch shortcut, from the same table the key handler uses. */
import { Dialog } from '../../ui';
import { SHORTCUT_HELP } from '../../replay/shortcuts';
import { CAMERA_SLOTS } from './cameras';

export function HelpOverlay(props: { open: boolean; onClose(): void }): JSX.Element | null {
  return (
    <Dialog open={props.open} onClose={props.onClose} title="Keyboard shortcuts" wide>
      <div className="wh-grid">
        <table className="wh-table">
          <tbody>
            {SHORTCUT_HELP.map((r) => (
              <tr key={r.what}>
                <th scope="row">{r.keys.map((k) => <kbd key={k}>{k}</kbd>)}</th>
                <td>{r.what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="wh-table">
          <caption>Cameras</caption>
          <tbody>
            {CAMERA_SLOTS.filter((c) => c.slot !== null).map((c) => (
              <tr key={c.id}>
                <th scope="row"><kbd>{c.slot}</kbd></th>
                <td><b>{c.label}</b> — {c.hint}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}
