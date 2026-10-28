// Personal and payroll data must never sit in a browser or proxy cache.
export const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
