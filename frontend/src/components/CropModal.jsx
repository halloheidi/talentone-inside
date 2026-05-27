import { useCallback, useState } from 'react';
import Cropper from 'react-easy-crop';
import Modal from './Modal.jsx';

/**
 * Modal mit react-easy-crop, festem 16:9-Aspect.
 * onConfirm bekommt { x, y, width, height } in Source-Pixel-Koordinaten.
 */
export default function CropModal({ open, imageUrl, onCancel, onConfirm }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleComplete = useCallback((_, areaPixels) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  async function confirm() {
    if (!croppedAreaPixels) return;
    setBusy(true);
    setError('');
    try {
      await onConfirm(croppedAreaPixels);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function close() { if (!busy) onCancel(); }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Bildausschnitt für 16:9 wählen"
      footer={
        <>
          <button className="btn-ghost" onClick={close} disabled={busy}>Abbrechen</button>
          <button className="btn-primary" onClick={confirm} disabled={busy || !croppedAreaPixels}>
            {busy ? 'Schneide zu…' : 'Zuschneiden'}
          </button>
        </>
      }
    >
      <p className="pane-hint">
        Verschieben mit der Maus, zoomen mit dem Slider oder Mausrad. Der Rahmen ist fix auf 16:9.
      </p>
      <div className="crop-stage">
        {imageUrl && (
          <Cropper
            image={imageUrl}
            crop={crop}
            zoom={zoom}
            aspect={16 / 9}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={handleComplete}
            showGrid={true}
            objectFit="contain"
          />
        )}
      </div>
      <div className="crop-zoom">
        <label>Zoom</label>
        <input
          type="range"
          min={1}
          max={4}
          step={0.05}
          value={zoom}
          onChange={e => setZoom(parseFloat(e.target.value))}
          disabled={busy}
        />
      </div>
      {error && <div className="alert alert-error" style={{ marginTop: 8 }}>{error}</div>}
    </Modal>
  );
}
