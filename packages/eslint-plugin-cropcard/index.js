import noRawTenantTable from './rules/no-raw-tenant-table.js';

const plugin = {
  meta: {
    name: 'eslint-plugin-cropcard',
    version: '0.1.0'
  },
  rules: {
    'no-raw-tenant-table': noRawTenantTable
  }
};

export default plugin;
