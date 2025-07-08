module.exports = {
  packagerConfig: {
    asar: true,
    icon: 'logo.ico'
  },
  makers: [
    {
      name: "@electron-forge/maker-zip",
      platforms: ["linux"],
    },
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        setupIcon: 'logo.ico'
      }
    },
  ],
  files: ["**/*", "!*.log"],
};
