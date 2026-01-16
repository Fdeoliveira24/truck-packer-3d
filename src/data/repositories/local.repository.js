import { STORAGE_KEYS } from '../../core/constants.js';
import { readJson, writeJson } from '../../core/storage.js';
import { deepClone } from '../../utils/json.js';
import { uuid } from '../../utils/uuid.js';
import { BaseRepository } from './base.repository.js';

function emptyData() {
  return { version: 1, savedAt: Date.now(), preferences: null, orgData: {} };
}

function ensureOrg(data, orgId) {
  const next = data;
  next.orgData = next.orgData && typeof next.orgData === 'object' ? next.orgData : {};
  next.orgData[orgId] = next.orgData[orgId] && typeof next.orgData[orgId] === 'object' ? next.orgData[orgId] : {};
  return next;
}

function storeKeyForEntity(entityKey) {
  // Align with legacy naming used by the current UI state.
  if (entityKey === 'cases') return 'caseLibrary';
  if (entityKey === 'packs') return 'packLibrary';
  return entityKey;
}

export class LocalRepository extends BaseRepository {
  constructor(entityKey) {
    super();
    this.entityKey = String(entityKey || '').trim();
    if (!this.entityKey) throw new Error('Missing entityKey');
    this.storeKey = storeKeyForEntity(this.entityKey);
  }

  _read() {
    const data = readJson(STORAGE_KEYS.appData, emptyData());
    return data && typeof data === 'object' ? data : emptyData();
  }

  _write(data) {
    writeJson(STORAGE_KEYS.appData, data);
  }

  async findAll(filter = {}) {
    const orgId = String(filter.orgId || '').trim();
    const data = this._read();
    if (!orgId) return [];
    const org = data.orgData && data.orgData[orgId] ? data.orgData[orgId] : {};
    const list = Array.isArray(org[this.storeKey]) ? org[this.storeKey] : [];
    return deepClone(list);
  }

  async find(id, filter = {}) {
    const orgId = String(filter.orgId || '').trim();
    if (!orgId) return null;
    const list = await this.findAll({ orgId });
    return list.find(it => it && it.id === id) || null;
  }

  async create(data, options = {}) {
    const orgId = String(options.orgId || '').trim();
    if (!orgId) throw new Error('Missing orgId');
    const next = this._read();
    ensureOrg(next, orgId);
    const org = next.orgData[orgId];
    org[this.storeKey] = Array.isArray(org[this.storeKey]) ? org[this.storeKey] : [];
    const item = { ...deepClone(data), id: data && data.id ? data.id : uuid(), orgId };
    org[this.storeKey].push(item);
    this._write(next);
    return deepClone(item);
  }

  async update(id, patch, options = {}) {
    const orgId = String(options.orgId || '').trim();
    if (!orgId) throw new Error('Missing orgId');
    const next = this._read();
    ensureOrg(next, orgId);
    const org = next.orgData[orgId];
    const list = Array.isArray(org[this.storeKey]) ? org[this.storeKey] : [];
    const idx = list.findIndex(it => it && it.id === id);
    if (idx < 0) return null;
    const updated = { ...list[idx], ...deepClone(patch) };
    list[idx] = updated;
    org[this.storeKey] = list;
    this._write(next);
    return deepClone(updated);
  }

  async delete(id, options = {}) {
    const orgId = String(options.orgId || '').trim();
    if (!orgId) throw new Error('Missing orgId');
    const next = this._read();
    ensureOrg(next, orgId);
    const org = next.orgData[orgId];
    const list = Array.isArray(org[this.storeKey]) ? org[this.storeKey] : [];
    const before = list.length;
    org[this.storeKey] = list.filter(it => it && it.id !== id);
    this._write(next);
    return org[this.storeKey].length !== before;
  }
}
