---
layout: layouts/post.njk
title: Practical Skyline Queries In Go
date: 2025-08-02
description: A practical introduction to skyline queries in Go, including a command line tool for skyline calculations.
excerpt: "<i>(Originally published on <a href='https://dev.to/gkoos/practical-skyline-queries-in-go-1mb9'>Dev.to</a></i>)<br><br>
We have a set of points in a multi-dimensional space, and we want to find the points that are not dominated by any other point. (Point A <i>dominates</i> another point B if A is better than B in all dimensions..."
canonical: https://dev.to/gkoos/practical-skyline-queries-in-go-1mb9
tags:
- posts
- tutorials
- algorithms
- golang
- skyline (go library)
---
_(Originally published on [Dev.to](https://dev.to/gkoos/practical-skyline-queries-in-go-1mb9))_

## Skyline Queries?

Summer is in full swing, the weather outside is hot and sunny. And here I am at my desk, scribbling away while my mind is sipping margaritas in a hotel bar somewhere in the Caribbean. But how do I decide which hotel? Close to the beach? Good reviews? Cheap? Can I find a hotel that's closer to the beach, has better reviews, and is cheaper than all the other hotels? Probably not. But with so many options to choose from, I can eliminate hotels that are worse in every aspect than others. This is the essence of skyline queries: finding the best options in a multi-dimensional problem space (in this case, distance from the beach, prices and reviews).

I wrote a quick introduction to skyline queries [here](/posts/2025-07-31-Skyline-Queries-For-Non-Academics/), but for those who want something even quicker:

We have a set of points in a multi-dimensional space, and we want to find the points that are not dominated by any other point. (Point A *dominates* another point B if A is better than B in all dimensions. Note that "better" can mean either larger - like ratings, or smaller - like distance to the beach.) The points that are not dominated by any other point are called *skyline points* and we find them by executing a *skyline query*.

Now for small datasets like a bunch of hotels in an area, we can just iterate through all points, compare them to the others and find the skyline points. But this process can be useful for large datasets as well if we want to reduce complexity. Essentially, to simplify data, we have two options: we can reduce the number of dimensions or reduce the number of points. There are multiple ways to do the former, like Principal Component Analysis (PCA) or t-Distributed Stochastic Neighbor Embedding (t-SNE), but there are typically more points than dimensions, so focusing on reducing the number of points makes sense too. Skyline queries are a great way to do that.

But for large datasets, we can't just iterate through all points and compare them to each other. We need a more efficient way to find the skyline points. This is where the algorithms come in. There are several algorithms for skyline queries, each with its own strengths and weaknesses. Some are more efficient for certain types of data, while others are more general-purpose.

A short list of some of the skyline algorithms:

1. **Block Nested Loop (BNL)** - the simplest algorithm, which iterates through all points and compares them to each other. It has a time complexity of O(n^2), where n is the number of points. This is not efficient for large datasets, but it is easy to implement and understand.
2. **Divide and Conquer** - this algorithm divides the points into smaller subsets, finds the skyline points in each subset, and then combines them. It has a time complexity of O(n log n) and is more efficient than BNL for larger datasets.
3. **Sort and Sweep** - this algorithm sorts the points along one dimension and then sweeps through them to find the skyline points. It has a time complexity of O(n log n) due to the sorting step.
4. **R-tree based approaches** - these algorithms use spatial indexing structures like R-trees to efficiently find skyline points. They can be very efficient for large datasets, but they require more complex data structures.
5. **Skyline join** - this algorithm is used in database systems to find skyline points in the result of a join operation. It can be very efficient for certain types of queries.
6. **Skytree** - this is a data structure that can be used to efficiently find skyline points. It is based on the concept of a tree, where each node represents a point and its children represent the points that are dominated by it. It has a time complexity of O(n log n) for finding skyline points (like similar tree-based algorithms).

Oddly enough, you will find these algorithms mostly in academic papers, but not in production code. Luckily for us, I created the [skyline](https://github.com/gkoos/skyline) library that implements the BNL, Divide&Conquer, and Skytree algorithms in go so we can carry on with this article.

## What Are We Going to Build?

The title in this article says "practical", so we *must* build something, right? However, skyline queries are either very trivial for small datasets or very computation-heavy for large datasets, so hosting a skyline query backend just for the sake of this article can be tricky (and expensive). 

Instead, we will build a simple command line tool that takes a CSV file where columns are dimensions and rows are points, with 2 dimensions to consider for the skyline query as command line arguments. The program calculates the skylines and outputs a new CSV file with the two dimensions and a new column that indicates whether the point is a skyline point or not. Then we can upload this new CSV to a tool like [Rawgraphs](https://app.rawgraphs.io/) to visualize the results.

This way, we neither have to deal with a complex frontend nor hosting a pricey backend. Your computer will do the heavy lifting of calculating the skyline points, the community will do the visualisation and I can keep this article short and sweet. How convenient!

### Usage

To use the tool, you can checkout the accompanying [repository](https://github.com/gkoos/practical-skyline-queries-in-go), or just download one of the pre-built binaries from the [releases folder](https://github.com/gkoos/practical-skyline-queries-in-go/tree/main/releases). Or you can follow along with the code in this article.

If you checked out the repository, you can run the tool with the following command:

```bash
go run main.go --input data.csv --output skylines.csv --dim1 0 --dim2 1 --dim1pref max --dim2pref min --algo bnl
```

If you downloaded a pre-built binary, this changes to:

```bash
./practical-skyline-queries --input data.csv --output skylines.csv --dim1 0 --dim2 1 --dim1pref max --dim2pref min --algo bnl
```

This will read the `data.csv` file, calculate the skyline points for the first two dimensions (0 and 1), and write the results to `skylines.csv`. The output file will contain the original two dimensions and an additional column `skyline` indicating whether the point is a skyline point or not. 

`--dim1` and `--dim2` specify the dimensions to consider for the skyline query, which can be any two columns in the CSV file. The `--dim1pref` and `--dim2pref` flags specify whether we want to maximize or minimize the values in those dimensions (default is `min` for both).

`--algo` specifies the algorithm to use, which can be `bnl`, `dnc` (for Divide&Conquer) or `skytree`. If you don't specify an algorithm, it defaults to `bnl`.

The tool displays the time it took to calculate the skyline points, which can be useful for performance testing:

```bash
$ go run main.go --input data.csv --output skylines.csv --dim1 0 --dim2 1 --dim1pref max --dim2pref min --algo bnl
Skyline calculation completed!
✓ Completed in 1.0456ms
```

Once the calculation is done, the easiest way to visualize the results is to upload the `skylines.csv` file to a tool like [Rawgraphs](https://app.rawgraphs.io/). You can select the two dimensions and the `skyline` column to visualize the skyline points in a scatter plot or any other suitable chart type.

### Example Data

You can use the example data from the `/data` folder in the repository, or create your own CSV file. The file should have a header row with the names of the dimensions, and each subsequent row should contain the values for each point.

[Kaggle](https://www.kaggle.com) has some great datasets to play with.

## Let's Do This!

Ok, it's time to get our hands dirty and build this tool. Open your favorite IDE/code editor and let's get started.

### Scaffolding the Project

First, create a new directory for your project and initialize a Go module:

```bash
mkdir practical-skyline-queries
cd practical-skyline-queries
go mod init practical-skyline-queries
```

Next, create a `main.go` file in the project directory. This will be the entry point of our application.

Then, because Go is a compiled language, we need to add scripts to build the binary for different platforms. One way to do it would be using Makefile, but I'm on Windows so let's just use a Go script. Create `build.go` in the root of the project and add the following code:

```go
//go:build ignore

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Println("Usage: go run build.go [all|linux|windows|macos|clean]")
		return
	}

	command := os.Args[1]

	switch command {
	case "all":
		buildAll()
	case "linux":
		buildLinux()
	case "windows":
		buildWindows()
	case "macos":
		buildMacOS()
	case "clean":
		clean()
	default:
		fmt.Printf("Unknown command: %s\n", command)
	}
}

func buildAll() {
	fmt.Println("Building for all platforms...")
	buildLinux()
	buildWindows()
	buildMacOS()
}

func buildLinux() {
	fmt.Println("Building for Linux...")
	build("linux", "amd64", "releases/linux/practical-skyline-queries")
}

func buildWindows() {
	fmt.Println("Building for Windows...")
	build("windows", "amd64", "releases/windows/practical-skyline-queries.exe")
}

func buildMacOS() {
	fmt.Println("Building for macOS...")
	build("darwin", "amd64", "releases/macos/practical-skyline-queries")
}

func build(goos, goarch, output string) {
	os.MkdirAll(filepath.Dir(output), 0755)

	cmd := exec.Command("go", "build", "-o", output)
	cmd.Env = append(os.Environ(), "GOOS="+goos, "GOARCH="+goarch)

	if err := cmd.Run(); err != nil {
		fmt.Printf("Error building for %s/%s: %v\n", goos, goarch, err)
	} else {
		fmt.Printf("Successfully built: %s\n", output)
	}
}

func clean() {
	fmt.Println("Cleaning build artifacts...")
	os.RemoveAll("bin")
	os.RemoveAll("releases")
	fmt.Println("Clean complete!")
}
```

This script will allow you to build the binary for different platforms (Linux, Windows, macOS) and clean up the build artifacts. You can run it with:

```bash
# Build for all platforms
go run build.go all

# Build for specific platforms
go run build.go linux
go run build.go windows
go run build.go macos

# Clean build artifacts
go run build.go clean
```

If you want to use git for version control, you can initialize a new repository:

```bash
git init
```

And create a `.gitignore` file to exclude unnecessary files.

### Dependencies

For parsing command line arguments, we can use the `flag` package of the standard library as it is sufficient for our use case (simple arguments).

For reading and writing CSV files, we'll use the `encoding/csv` package from the standard library, which provides robust CSV parsing capabilities.

To spice things up a bit, we can use the [color](https://pkg.go.dev/github.com/fatih/color) package for colorized terminal output:

```bash
go get github.com/fatih/color
```

The final external dependency we need is the [skyline](https://pkg.go.dev/github.com/gkoos/skyline) library:

```bash
go get github.com/gkoos/skyline
```

And this is all we need for our project. We can now start implementing the command line tool.

### Coding Deep-Dive

Our tool has the following workflow:

![Skyline Query Tool Workflow](https://i.imgur.com/n29uWfE.png)

Let's implement each step!

#### Command Line Arguments

The entry point of our application is the `main.go` file. Here we will parse the command line arguments to get the input CSV file, output CSV file, dimensions to consider for the skyline query, the preferences for each dimension and the algorithm to use.

```go
// main.go
package main

import (
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/fatih/color"
)

type Config struct {
	InputFile  string
	OutputFile string
	Dim1       int
	Dim2       int
	Dim1Pref   string
	Dim2Pref   string
	Algorithm  string
}

func main() {
	start := time.Now()

	config, err := parseArgs()

	if err != nil {
		color.Red("Error: %v\n", err)
		flag.Usage()
		os.Exit(1)
	}

	run(config)

	elapsed := time.Since(start)
	color.Green("✓ Completed in %v", elapsed)
}

func parseArgs() (*Config, error) {
	inputFile := flag.String("input", "", "Path to the input CSV file - required")
	outputFile := flag.String("output", "", "Path to the output CSV file - required")
	d1 := flag.Int("dim1", -1, "Index of Dimension 1 (e.g., 0 for the first column) - required")
	d2 := flag.Int("dim2", -1, "Index of Dimension 2 (e.g., 1 for the second column) - required")
	d1Pref := flag.String("dim1pref", "min", "Preference for Dimension 1 (min|max)")
	d2Pref := flag.String("dim2pref", "min", "Preference for Dimension 2 (min|max)")
	algorithm := flag.String("algo", "bnl", "Skyline algorithm to use (bnl|dnc|skytree)")

	flag.Parse()

	// Validation
	if *inputFile == "" || *outputFile == "" {
		return nil, fmt.Errorf("input and output file paths must be specified")
	}
	if *d1 < 0 || *d2 < 0 {
		return nil, fmt.Errorf("dimensions must be specified (>= 0)")
	}
	if *d1Pref != "min" && *d1Pref != "max" {
		return nil, fmt.Errorf("invalid preference for Dimension 1: %s (must be 'min' or 'max')", *d1Pref)
	}
	if *d2Pref != "min" && *d2Pref != "max" {
		return nil, fmt.Errorf("invalid preference for Dimension 2: %s (must be 'min' or 'max')", *d2Pref)
	}
	if *algorithm != "bnl" && *algorithm != "dnc" && *algorithm != "skytree" {
		return nil, fmt.Errorf("invalid algorithm: %s (must be 'bnl', 'dnc', or 'skytree')", *algorithm)
	}
	
	return &Config{
		InputFile:  *inputFile,
		OutputFile: *outputFile,
		Dim1:       *d1,
		Dim2:       *d2,
		Dim1Pref:   *d1Pref,
		Dim2Pref:   *d2Pref,
		Algorithm:  *algorithm,
	}, nil
}

func run(config *Config) {
	fmt.Printf("Input File: %s\n", config.InputFile)
	fmt.Printf("Output File: %s\n", config.OutputFile)
	fmt.Printf("Dimensions: %d, %d\n", config.Dim1, config.Dim2)
	fmt.Printf("Preferences: %s, %s\n", config.Dim1Pref, config.Dim2Pref)
	fmt.Printf("Algorithm: %s\n", config.Algorithm)
}
```

Here we already have a basic command line tool that can parse the input arguments. The `parseArgs` function validates the input and returns a `Config` struct with the parsed values. If any validation fails, it prints an error message and exits. Not the most user-friendly, but we can ensure that the parameters are valid before proceeding with the skyline calculation. Well, except if the input file does not exist, or is not valid CSV. But we will handle that later.

Let's try:

```bash
go run main.go --input input.csv --output output.csv --dim1 0 --dim2 1
Input File: input.csv
Output File: output.csv
Dimensions: 0, 1
Preferences: min, min
Algorithm: bnl
```

Thanks to `flag`, we can display a usage message with `-h` or `--help`:

```bash
go run main.go --help
Usage of main.exe:
  -algo string
        Skyline algorithm to use (bnl|dnc|skytree) (default "bnl")
  -dim1 int
        Index of Dimension 1 (e.g., 0 for the first column) - required (default -1)
  -dim1pref string
        Preference for Dimension 1 (min|max) (default "min")
  -dim2 int
        Index of Dimension 2 (e.g., 1 for the second column) - required (default -1)
  -dim2pref string
        Preference for Dimension 2 (min|max) (default "min")
  -input string
        Path to the input CSV file - required
  -output string
        Path to the output CSV file - required
```

#### Reading the CSV File

Next, we need to read the input CSV file and parse it into a slice of slices of strings. Each inner slice will represent a row in the CSV file, and each string will represent a value in that row. However, even if the data can have several dimensions, we will only consider the two dimensions specified by the user for the skyline query and only keep this streamlined data in memory.

First, let's add `"encoding/csv"` to the imports:

```go
// main.go
import (
	"encoding/csv"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/fatih/color"
)
```

Next, we will implement the `readCSV` function that reads the CSV file and returns the data as a slice of slices of strings:

```go
// main.go
func readCSV(filePath string, dim1 int, dim2 int) ([][]string, error) {
	// Open the CSV file
	file, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("error opening file: %v", err)
	}
	defer file.Close()

	// Create CSV reader
	reader := csv.NewReader(file)

	var result [][]string
	recordCount := 0

	// Read records one by one to save memory
	for {
		record, err := reader.Read()
		if err != nil {
			if err.Error() == "EOF" {
				break
			}
			return nil, fmt.Errorf("error reading CSV: %v", err)
		}

		// Check dimensions on first record
		if recordCount == 0 {
			if len(record) <= dim1 || len(record) <= dim2 {
				return nil, fmt.Errorf("dimension indices out of range: file has %d columns, requested dims %d and %d",
					len(record), dim1, dim2)
			}
		}

		// Extract only the specified dimensions
		result = append(result, []string{record[dim1], record[dim2]})
		recordCount++
	}

	// Check if file was empty
	if recordCount == 0 {
		return nil, fmt.Errorf("CSV file is empty")
	}

	return result, nil
}
```

The logic is straightforward: we read the CSV file line by line, checking that the requested dimensions are valid, and extracting only the relevant columns into memory.

Now let's add this step to the `run` function:

```go
func run(config *Config) {
	data, err := readCSV(config.InputFile, config.Dim1, config.Dim2)
	if err != nil {
		color.Red("Error reading CSV: %v\n", err)
		return
	}

	// Process the data
	fmt.Printf("Data: %v\n", data)
}
```

Now we can run the tool with a valid CSV file and see if it reads the data correctly:

```bash
go run main.go --input data/hotels.csv --output output.csv --dim1 1 --dim2 2
Data: [[rating user_rating] [5 4.2] [4 4.8] [3 3.5] [4 4.1] [5 3.9] [3 4.6] [5 4.4] [2 3.2] [5 4.9] [4 4.3] [3 3.8] [4 4.7] [5 4.0] [2 3.9] [4 4.5] [3 3.6] [5 4.1] [2 4.3] [4 3.7] [3 4.4] [5 4.8] [2 3.4] [4 4.6] 
[3 3.3] [5 4.2] [2 4.0] [4 4.9] [3 3.1] [5 4.7] [4 3.8]]
✓ Completed in 524.7µs
```

#### Skyline Calculation

And now let the fun begin! First, let's import the skyline library we installed earlier. We also need to import the `strconv` package for converting string values to float64, which is necessary for the skyline calculations:

```go
// main.go
import (
  // ...other imports
  "strconv"
  // ...
  "github.com/gkoos/skyline/skyline"
)
```

Note that while we download the module with `go get github.com/gkoos/skyline`, we import the `skyline` subpackage in our code: `"github.com/gkoos/skyline/skyline"`.

Now we can implement the skyline calculation. We will create a function `computeSkyline` that takes the data and the preferences for each dimension, transforms the data into the appropriate format, and returns the skyline points:

```go
// main.go
func computeSkyline(data [][]string, config *Config) ([]skyline.Point, error) {
	// Make sure there's data
	if len(data) <= 1 {
		return nil, fmt.Errorf("not enough data for skyline calculation (need at least 2 rows including header)")
	}

	// Prepare data for skyline calculation (skip header)
	rawData := data[1:]

	// Convert string data to skyline.Point format
	var points []skyline.Point
	for _, row := range rawData {
		// Convert strings to float64
		val1, err1 := strconv.ParseFloat(row[0], 64)
		val2, err2 := strconv.ParseFloat(row[1], 64)
		if err1 != nil || err2 != nil {
			return nil, fmt.Errorf("error parsing numeric values in row: %v", row)
		}
		points = append(points, skyline.Point{val1, val2})
	}

	// Set up preferences from config
	var prefs skyline.Preference
	if config.Dim1Pref == "min" {
		prefs = append(prefs, skyline.Min)
	} else {
		prefs = append(prefs, skyline.Max)
	}
	if config.Dim2Pref == "min" {
		prefs = append(prefs, skyline.Min)
	} else {
		prefs = append(prefs, skyline.Max)
	}

	// Calculate skyline
	return skyline.Skyline(points, nil, prefs, config.Algorithm)
}
```

Let's add this step to the `run` function as well:

```go
func run(config *Config) {
	data, err := readCSV(config.InputFile, config.Dim1, config.Dim2)
	if err != nil {
		color.Red("Error reading CSV: %v\n", err)
		return
	}

	result, err := computeSkyline(data, config)
	if err != nil {
		color.Red("Error calculating skyline: %v\n", err)
		return
	}

	color.Green("Skyline calculation completed!")
	fmt.Printf("Skyline (%s): %v\n", config.Algorithm, result)
}
```

#### Writing the Output CSV

Finally, we need to write the skyline points to the output CSV file. We will create a function `writeCSV` that takes the skyline points and writes them to a CSV file along with the original data:

```go
func writeOutputCSV(filePath string, originalData [][]string, skylinePoints []skyline.Point, config *Config) error {
	file, err := os.Create(filePath)
	if err != nil {
		return fmt.Errorf("error creating file: %v", err)
	}
	defer file.Close()

	writer := csv.NewWriter(file)
	defer writer.Flush()

	// Write header
	header := []string{originalData[0][0], originalData[0][1], "skyline"}
	if err := writer.Write(header); err != nil {
		return fmt.Errorf("error writing header: %v", err)
	}

	// Convert skyline points to a map for quick lookup
	skylineMap := make(map[string]bool)
	for _, point := range skylinePoints {
		key := fmt.Sprintf("%.6f,%.6f", point[0], point[1])
		skylineMap[key] = true
	}

	// Write data rows
	for i := 1; i < len(originalData); i++ {
		row := originalData[i]

		// Parse the values
		val1, err1 := strconv.ParseFloat(row[0], 64)
		val2, err2 := strconv.ParseFloat(row[1], 64)
		if err1 != nil || err2 != nil {
			continue // Skip invalid rows
		}

		key := fmt.Sprintf("%.6f,%.6f", val1, val2)
		isSkyline := "false"
		if skylineMap[key] {
			isSkyline = "true"
		}

		record := []string{row[0], row[1], isSkyline}
		if err := writer.Write(record); err != nil {
			return fmt.Errorf("error writing record: %v", err)
		}
	}

	return nil
}
```

This function creates a new CSV file, writes the header, and then writes each row of the original data along with a new column indicating whether the point is a skyline point or not. We also make sure to skip invalid rows that cannot be parsed as floats.

We can now add this step to the `run` function:

```go
func run(config *Config) {
	data, err := readCSV(config.InputFile, config.Dim1, config.Dim2)
	if err != nil {
		color.Red("Error reading CSV: %v\n", err)
		return
	}

	result, err := computeSkyline(data, config)
	if err != nil {
		color.Red("Error calculating skyline: %v\n", err)
		return
	}

	err = writeOutputCSV(config.OutputFile, data, result, config)
	if err != nil {
		color.Red("Error writing output CSV: %v\n", err)
		return
	}

	color.Green("Skyline calculation completed!")
}
```

And that's it! We have a complete command line tool that reads a CSV file, calculates the skyline points for the specified dimensions, and writes the results to a new CSV file.

### Testing the Tool

Now we can see if everything works as expected. Let's run the tool with a sample CSV file:

```bash
go run main.go --input data/hotels.csv --output output.csv --dim1 1 --dim2 2 --dim1pref max --dim2pref max
Skyline calculation completed!
✓ Completed in 1.0456ms
```

Let's check the `output.csv` file:

```csv
rating,user_rating,skyline
5,4.2,false
4,4.8,false
3,3.5,false
4,4.1,false
5,3.9,false
3,4.6,false
5,4.4,false
2,3.2,false
5,4.9,true
4,4.3,false
...
3,3.1,false
5,4.7,false
4,3.8,false
```

We can see that the output file contains the original dimensions and a new column `skyline` indicating whether the point is a skyline point or not.

### Visualizing the Results

Open your browser and go to [Rawgraphs](https://app.rawgraphs.io/). Upload the `output.csv` file, choose Bubble Chart (it's their version of a scatter plot), select the `rating` and `user_rating` columns for the X and Y axes, and use the `skyline` column to color the points. You should see a scatter plot with the skyline points highlighted.

![Rawgraphs Skyline Visualization](https://i.imgur.com/ZO7LHK0.png)

And this means our hotels dataset only has one skyline point, which is the hotel with the highest rating and user rating. Too bad we probably can't afford it!

(Also, we lost the name of the hotel in the process, but we can easily modify the code to keep it if needed.)

### Next Steps

Where the skyline library truly shines is with large datasets. You can try it with a larger dataset, like the [Airbnb listings dataset](https://www.kaggle.com/datasets/airbnb/seattle), or any other dataset you find interesting. Just make sure to adjust the dimensions (and the algorithm used!) accordingly.

The only reason we only used two dimensions for the calculations and ditched the rest is that we wanted to keep the example simple and easy to visualize. However, the skyline library can handle any number of dimensions, so you can easily extend the tool to support more dimensions if needed.

Important to remember that as the dataset grows, the BNL algorithm may become very inefficient, so you might want to switch to the Divide&Conquer or Skytree algorithms for better performance. You can do this by changing the `--algo` flag when running the tool. It's not always easy to tell beforehand which algorithm will perform best, so you might want to try them all and see which one works best for your dataset.

## Conclusion

In this article, we built a command-line tool in Go to compute skyline points from a CSV file. We covered reading and writing CSV files, calculating the skyline, and visualizing the results. With this foundation, you can explore more advanced features and optimizations, such as handling larger datasets or integrating with other data processing tools.

Another feature of the skyline library is that it can handle dynamic data, meaning you can add or remove points and recalculate the skyline without having to reprocess the entire dataset. This can be useful for real-time applications or when dealing with streaming data.
