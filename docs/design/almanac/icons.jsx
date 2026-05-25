/* Shared icon set — Lucide-style line icons, inline SVG so no CDN dep.
   Each accepts size + color via props. Names match nav concepts. */
const SVG = ({ children, size = 18, stroke = "currentColor", strokeWidth = 1.75, fill = "none", ...rest }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill}
    stroke={stroke}
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...rest}
  >
    {children}
  </svg>
);

const Icon = {
  Sun: (p) => <SVG {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></SVG>,
  Calendar: (p) => <SVG {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></SVG>,
  Sprout: (p) => <SVG {...p}><path d="M7 20h10" /><path d="M10 20c5.5-2.5.8-6.4 3-10" /><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.4-.8-2.3-2.3-3-4.2 2.8-.5 4.4 0 5.5.8z" /><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-.9 1.7-2.3 2.2-4.2-2.7-.2-4.3.4-5.4 1.6z" /></SVG>,
  Spray: (p) => <SVG {...p}><path d="M5 12V7a2 2 0 0 1 2-2h4" /><path d="M11 3h2v6h-2z" /><path d="M5 22h6a2 2 0 0 0 2-2v-8H3v8a2 2 0 0 0 2 2z" /><path d="M16 4l4 1M16 8l4-1M16 11l4 2" /></SVG>,
  Search: (p) => <SVG {...p}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></SVG>,
  Bucket: (p) => <SVG {...p}><path d="M5 8h14l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 8z" /><path d="M7 8a5 5 0 0 1 10 0" /></SVG>,
  Eye: (p) => <SVG {...p}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></SVG>,
  Harvest: (p) => <SVG {...p}><path d="M12 22V12" /><path d="M12 12c-3-3-3-7 0-10 3 3 3 7 0 10z" /><path d="M5 19c2-4 5-6 7-7" /><path d="M19 19c-2-4-5-6-7-7" /></SVG>,
  Bale: (p) => <SVG {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3v18" /></SVG>,
  Beaker: (p) => <SVG {...p}><path d="M9 3h6" /><path d="M10 3v6.5L4 19a2 2 0 0 0 1.7 3h12.6A2 2 0 0 0 20 19L14 9.5V3" /><path d="M6.5 14h11" /></SVG>,
  Wrench: (p) => <SVG {...p}><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-2.5 2.5-2.5z" /></SVG>,
  Map: (p) => <SVG {...p}><path d="M3 6l6-2 6 2 6-2v16l-6 2-6-2-6 2V6z" /><path d="M9 4v16M15 6v16" /></SVG>,
  FileText: (p) => <SVG {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 13h6M9 17h6M9 9h2" /></SVG>,
  Settings: (p) => <SVG {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></SVG>,
  Alert: (p) => <SVG {...p}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h0" /></SVG>,
  Check: (p) => <SVG {...p}><path d="m20 6-11 11-5-5" /></SVG>,
  CheckCircle: (p) => <SVG {...p}><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></SVG>,
  X: (p) => <SVG {...p}><path d="M18 6 6 18M6 6l12 12" /></SVG>,
  Plus: (p) => <SVG {...p}><path d="M12 5v14M5 12h14" /></SVG>,
  ChevronRight: (p) => <SVG {...p}><path d="m9 18 6-6-6-6" /></SVG>,
  ChevronDown: (p) => <SVG {...p}><path d="m6 9 6 6 6-6" /></SVG>,
  ArrowRight: (p) => <SVG {...p}><path d="M5 12h14M13 5l7 7-7 7" /></SVG>,
  Cloud: (p) => <SVG {...p}><path d="M17.5 19a4.5 4.5 0 0 0 0-9 7 7 0 1 0-13.7 2 5 5 0 0 0 1.6 7H17.5z" /></SVG>,
  CloudRain: (p) => <SVG {...p}><path d="M16 13a4 4 0 0 0 0-8 6 6 0 1 0-11.2 1.7A4.5 4.5 0 0 0 6 15h10z" /><path d="M8 19v2M12 19v3M16 19v2" /></SVG>,
  Wind: (p) => <SVG {...p}><path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2M9.6 4.6A2 2 0 1 1 11 8H2M12.6 19.4A2 2 0 1 0 14 16H2" /></SVG>,
  Thermometer: (p) => <SVG {...p}><path d="M14 4v10.5a4 4 0 1 1-4 0V4a2 2 0 1 1 4 0z" /></SVG>,
  Droplet: (p) => <SVG {...p}><path d="M12 2.7s5 6 5 11a5 5 0 0 1-10 0c0-5 5-11 5-11z" /></SVG>,
  Layers: (p) => <SVG {...p}><path d="m12 2 10 6-10 6L2 8z" /><path d="m2 17 10 6 10-6M2 12l10 6 10-6" /></SVG>,
  Box: (p) => <SVG {...p}><path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="m3.3 7 8.7 5 8.7-5M12 22V12" /></SVG>,
  Menu: (p) => <SVG {...p}><path d="M3 6h18M3 12h18M3 18h18" /></SVG>,
  Bell: (p) => <SVG {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></SVG>,
  User: (p) => <SVG {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></SVG>,
  Lock: (p) => <SVG {...p}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></SVG>,
  Info: (p) => <SVG {...p}><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h0" /></SVG>,
  Filter: (p) => <SVG {...p}><path d="M22 3H2l8 9v7l4 2v-9z" /></SVG>,
  Compass: (p) => <SVG {...p}><circle cx="12" cy="12" r="10" /><path d="m16.2 7.8-2.9 6.9-6.9 2.9 2.9-6.9z" /></SVG>,
  Leaf: (p) => <SVG {...p}><path d="M11 20A7 7 0 0 1 4 13c0-6 7-9 16-9 0 9-3 16-9 16zM2 22c1-6 7-12 13-12" /></SVG>,
  Field: (p) => <SVG {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></SVG>,
  Tractor: (p) => <SVG {...p}><circle cx="7" cy="17" r="4" /><circle cx="17" cy="17" r="3" /><path d="M11 17H7" /><path d="M11 5h4l3 6v6h-3M11 11V5H8L5 13" /></SVG>,
  Tool: (p) => <SVG {...p}><path d="M14.7 6.3a4 4 0 0 1 5.6 5.6L18 14l-6-6 2.7-1.7zM12 8l-8 8v4h4l8-8" /></SVG>,
  Camera: (p) => <SVG {...p}><path d="M3 7a2 2 0 0 1 2-2h2.5l1.5-2h6l1.5 2H19a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><circle cx="12" cy="13" r="4" /></SVG>,
  Barcode: (p) => <SVG {...p}><path d="M3 4v16M6 4v16M9 4v12M9 18v2M12 4v16M15 4v12M15 18v2M18 4v16M21 4v16" /></SVG>,
  Keyboard: (p) => <SVG {...p}><rect x="2" y="6" width="20" height="13" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M10 14h4" /></SVG>,
  Edit: (p) => <SVG {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" /></SVG>,
  Tag: (p) => <SVG {...p}><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z" /><circle cx="7" cy="7" r="1.5" /></SVG>,
  Flashlight: (p) => <SVG {...p}><path d="M18 6c0-1.7-1.3-3-3-3H9C7.3 3 6 4.3 6 6v3l3 3v9h6v-9l3-3z" /></SVG>,
  Image: (p) => <SVG {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></SVG>,
  Sparkle: (p) => <SVG {...p}><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z" /><path d="M19 16l.8 2 2 .8-2 .8L19 21.5l-.8-2-2-.8 2-.8z" /></SVG>,
  Refresh: (p) => <SVG {...p}><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></SVG>,
};

window.Icon = Icon;
