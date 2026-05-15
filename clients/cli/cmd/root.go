package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:     "lextures",
	Short:   "lextures CLI - Command line interface for Lextures",
	Version: "0.1.0",
	Long: `A command line interface to work with lextures.
Manage courses, assignments, users and more.`,
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Println("Hello from Lextures CLI!")
	},
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func init() {
	// Root flags if needed
}
