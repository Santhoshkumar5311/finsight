// Region selects a banking route; it never converts or relabels account currencies.
export const regions = [
  { code: 'US', name: 'United States', currency: 'USD', provider: 'plaid', providerName: 'Plaid' },
  {
    code: 'IN',
    name: 'India',
    currency: 'INR',
    provider: 'icici-statement',
    providerName: 'ICICI statement import',
  },
  { code: 'OTHER', name: 'Other region', currency: null, provider: null, providerName: null },
];
export function regionalPreferences(state = {}) {
  const saved = state.preferences || {};
  const inferred =
    state.accounts?.some((a) => a.currency === 'INR') &&
    !state.accounts?.some((a) => a.currency === 'USD')
      ? 'IN'
      : 'US';
  const region = regions.some((r) => r.code === saved.region) ? saved.region : inferred;
  return { region };
}
export function bankingRoute(state, provider) {
  const prefs = regionalPreferences(state);
  const region = regions.find((r) => r.code === prefs.region);
  if (region.provider !== provider)
    throw Object.assign(
      new Error(
        'This banking provider is not available for your selected region. Change Region in Settings to connect a bank there.',
      ),
      { status: 409 },
    );
  return prefs;
}
export function plaidRegionalOptions(preferences) {
  bankingRoute({ preferences }, 'plaid');
  return { country_codes: ['US'], language: 'en' };
}
