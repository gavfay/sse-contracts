module.exports = {
  overrides: [
    {
      files: "*.sol",
      options: {
        tabWidth: 2,
        printWidth: 120,
        bracketSpacing: true,
        compiler: "0.8.17",
      },
    },
    {
      files: "*.ts",
      options: {
        tabWidth: 2,
        printWidth: 140,
      },
    },
  ],
};
