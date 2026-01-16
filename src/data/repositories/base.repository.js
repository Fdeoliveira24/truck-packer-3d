export class BaseRepository {
  async find(_id, _filter) {
    throw new Error('Not implemented');
  }

  async findAll(_filter) {
    throw new Error('Not implemented');
  }

  async create(_data, _options) {
    throw new Error('Not implemented');
  }

  async update(_id, _patch, _options) {
    throw new Error('Not implemented');
  }

  async delete(_id, _options) {
    throw new Error('Not implemented');
  }
}
