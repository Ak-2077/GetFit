/** @type {import('tailwindcss').Config} */
module.exports = {
  // NOTE: Update this to include the paths to all files that contain Nativewind classes.
  content: ["./App.tsx", 
    "./components/**/*.{js,jsx,ts,tsx}" , 
    "./app/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Poppins_400Regular'],
      },
      fontWeight: {
        normal: '400',
        medium: '500',
        semibold: '500',
        bold: '500',
        extrabold: '600',
        black: '600',
      },
    },
  },
  plugins: [],
}