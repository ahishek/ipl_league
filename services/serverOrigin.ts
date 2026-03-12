export const getServerOrigin = () => {
  const configured = import.meta.env.VITE_API_BASE_URL;
  if (configured) return configured;
  if (typeof window === 'undefined') return 'http://127.0.0.1:8787';

  const { hostname, port, origin } = window.location;
  const isLocalHost = hostname === '127.0.0.1' || hostname === 'localhost';
  if (isLocalHost && port !== '8787') {
    return 'http://127.0.0.1:8787';
  }

  return origin;
};
