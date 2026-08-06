import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function installThreeRuntime() {
  if (THREE.REVISION !== '185') {
    throw new Error(`Expected Three.js r185, received r${THREE.REVISION || 'unknown'}`);
  }

  window.THREE = { ...THREE, OrbitControls };
  const vendorReady = Reflect.get(window, '__tp3dVendorOk');
  if (typeof vendorReady === 'function') vendorReady('three');
  return true;
}
