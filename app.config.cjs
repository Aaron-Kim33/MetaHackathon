module.exports = ({ config }) => ({
  ...config,
  extra: process.env.POPOUT_LOCAL_DEV === '1' && !process.env.EAS_BUILD && process.env.NODE_ENV !== 'production'
    ? { apiUrl: process.env.POPOUT_API_URL, pairingToken: process.env.POPOUT_TOKEN }
    : {},
});
