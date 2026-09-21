/** Tailwind 仅用于布局工具类（间距/弹性/网格），颜色一律走 AntD token（C-50）。 */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  corePlugins: { preflight: false },
  theme: { extend: {} },
  plugins: []
};
