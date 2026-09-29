import noRawTenantTable from './rules/no-raw-tenant-table.js';
import noUnguardedHoldWrite from './rules/no-unguarded-hold-write.js';

const plugin = {
  meta: {
    name: 'eslint-plugin-cropcard',
    version: '0.1.0'
  },
  rules: {
    'no-raw-tenant-table': noRawTenantTable,
    'no-unguarded-hold-write': noUnguardedHoldWrite
  }
};

export default plugin;
