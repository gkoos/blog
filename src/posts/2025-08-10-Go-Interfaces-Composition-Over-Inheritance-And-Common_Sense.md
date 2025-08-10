---
layout: layouts/post.njk
title: Go Interfaces - Composition Over Inheritance - And Common Sense
date: 2025-08-10
description: A post about golanfg interfaces
excerpt: Coming from a language like C# or JavaScript, interfaces in Go can feel like a cruel joke. They’re not what you expect, and they don’t play by the rules you’re used to. This post is your survival guide to Go interfaces.
tags:
  - posts
  - tutorial
  - golang
---
Coming from a language like C# or JavaScript, interfaces in Go can feel like a cruel joke. They’re not what you expect, and they don’t play by the rules you’re used to. This post is your survival guide to Go interfaces.

## Interfaces - The Old Way

In more traditional languages, interfaces are binding contracts: you define methods in an interface, and a class in order to satisfy that interface must implement those methods. In exchange, at any point in your code where you expect that interface, you can pass any class that implements it.

Let's see a quick example. We want to log messages, but at this point we're not sure where. Maybe to a file, maybe to the console, maybe to a remote server. All we know is we want to log messages, warnings, and errors. So we define a Logger interface:

```csharp
public interface ILogger
{
  void Log(string message);
  void Warn(string message);
  void Error(string message);
}
```

We don't care what happens when we call these methods, but we know we will need them. At this point we just get on with our code and use these methods as if they were real:

```csharp
public class OrderProcessor
{
  private readonly ILogger _logger;

  public OrderProcessor(ILogger logger)
  {
    _logger = logger;
  }

  public void ProcessOrder(string orderId)
  {
    _logger.Log($"Processing order {orderId}...");
    
    if (string.IsNullOrEmpty(orderId))
    {
      _logger.Warn("Order ID is empty.");
      return;
    }

    if (!ChargePayment(orderId))
    {
      _logger.Error($"Failed to charge payment for order {orderId}.");
    }
    else
    {
      _logger.Log($"Order {orderId} processed successfully.");
    }
  }
}
```

So we do things, and from time to time we call methods on the Logger. Maybe while developing we log to the console, but later we want to log to a file. So we create a ScreenLogger and a Filelogger class that implement the ILogger interface:

```csharp
public class ScreenLogger : ILogger
{
  public void Log(string message) => Console.WriteLine($"[LOG] {message}");
  public void Warn(string message) => Console.WriteLine($"[WARN] {message}");
  public void Error(string message) => Console.WriteLine($"[ERROR] {message}");
}

public class FileLogger : ILogger
{
  private readonly string _filePath;

  public FileLogger(string filePath)
  {
    _filePath = filePath;
  }

  public void Log(string message) => File.AppendAllText(_filePath, $"[LOG] {message}\n");
  public void Warn(string message) => File.AppendAllText(_filePath, $"[WARN] {message}\n");
  public void Error(string message) => File.AppendAllText(_filePath, $"[ERROR] {message}\n");
}
```

Note that the `FileLogger` also has a constructor that takes a file path, which is not part of the `ILogger` interface. This is fine because, as long as the class implements the methods defined in the interface, it can have any additional methods or properties it needs.

This way, we can pass either a `ScreenLogger` or a `FileLogger` to the `OrderProcessor`, and it will work seamlessly:

```csharp
var logger: ILogger;
if (production)
{
  logger = new FileLogger("logs.txt");
}
else
{
  logger = new ScreenLogger();
}

var processor = new OrderProcessor(logger);
processor.ProcessOrder("12345");
```

Because both classes implement the `ILogger` interface, we can use them interchangeably. This is the essence of interfaces in traditional languages: they define a contract that classes must adhere to, allowing for polymorphism and flexibility.

## Interfaces in Go

In Go, interfaces are a bit different. They’re not explicit contracts that you implement; they’re more like a set of expectations that your types can fulfill without any formal declaration. This can be both liberating and confusing. The previous example would look like this in Go:

```go
package main

import (
	"fmt"
	"os"
)

// 1. Logger interface definition
type Logger interface {
	Log(message string)
	Warn(message string)
	Error(message string)
}


// 2. ScreenLogger implementation:
type ScreenLogger struct{}

func (ScreenLogger) Log(message string) {
	fmt.Printf("[LOG] %s\n", message)
}

func (ScreenLogger) Warn(message string) {
	fmt.Printf("[WARN] %s\n", message)
}

func (ScreenLogger) Error(message string) {
	fmt.Printf("[ERROR] %s\n", message)
}
// At this point ScreenLogger has Log, Warn, and Error methods.
// This means it satisfies the Logger interface!


// 3. FileLogger implementation:
type FileLogger struct {
	filePath string
}

// Creates a new FileLogger instance with the specified file path.
// This is similar to the constructor in C#.
func NewFileLogger(path string) *FileLogger {
	return &FileLogger{filePath: path}
}

// Helper method to append messages to a file.
// Not part of the Logger interface, but FileLogger needs it.
// It starts with lowercase so it's also private to this package.
func (f *FileLogger) appendToFile(prefix, message string) {
	file, err := os.OpenFile(f.filePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		fmt.Printf("Error opening log file: %v\n", err)
		return
	}
	defer file.Close()

	fmt.Fprintf(file, "%s %s\n", prefix, message)
}

func (f *FileLogger) Log(message string) {
	f.appendToFile("[LOG]", message)
}

func (f *FileLogger) Warn(message string) {
	f.appendToFile("[WARN]", message)
}

func (f *FileLogger) Error(message string) {
	f.appendToFile("[ERROR]", message)
}
// At this point FileLogger also has Log, Warn, and Error methods.
// This means it satisfies the Logger interface too!


// Business logic that depends on Logger
func ProcessOrder(orderID string, logger Logger) {
	logger.Log("Processing order " + orderID + "...")

	if orderID == "" {
		logger.Warn("Order ID is empty.")
		return
	}
	if orderID[len(orderID)-1] == '0' {
		logger.Error("Failed to charge payment for order " + orderID)
	} else {
		logger.Log("Order " + orderID + " processed successfully.")
	}
}

func main() {
	var logger Logger
	if production := false; production {
		logger = &FileLogger{"logs.txt"}
	} else {
		logger = ScreenLogger{}
	}

  ProcessOrder("12345", logger)
```

This Go code does the same thing as the C# example, but notice how we don't have to explicitly declare that `ScreenLogger` and `FileLogger` implement the `Logger` interface. They just do, and Go's compiler checks that they have the required methods.

This is called **implicit implementation**. If a type has the methods that an interface requires, it satisfies that interface. No need for a keyword like `implements` or `extends`. It's called **duck typing** in some circles, where the type is determined by its behavior rather than its explicit declaration. It's like Go is saying, "If it walks like a duck and quacks like a duck, it's a duck".

So the key difference in philosophy is:
- *Nominal Typing* (C#): "You are a Logger if you say you are (and the compiler agrees)."
- *Duck Typing* (Go): "You are a Logger if you walk and quack like one, you don't have to say anything."

## How Interfaces Are Actually Used In Go

In Go, interfaces are used extensively, often in ways that might feel odd. Here are some common patterns and practices:

### The `io.Writer` and `io.Reader` Pattern

The `io.Writer` and `io.Reader` interfaces are foundational in Go. They allow you to write data to various destinations (like files, network connections, or buffers) without caring about the underlying implementation. For example:

```go
package main

import (
	"fmt"
	"io"
	"os"
	"strings"
)

func main() {
	var w io.Writer // io.Writer is a Go interface with one method: Write(p []byte) (n int, err error)
	w = os.Stdout  // os.Stdout is a variable of type *os.File
	// *os.File has a Write([]byte) (int, error) method, so it implicitly satisfies io.Writer
	fmt.Fprintln(w, "Hello, World!") // Since w is os.Stdout, the text goes to your terminal

	var r io.Reader // io.Reader is a Go interface with one method: Read(p []byte) (n int, err error)
	r = strings.NewReader("Hello, Reader!") // strings.NewReader returns a *strings.Reader, which has a Read([]byte) (int, error) method
	io.Copy(os.Stdout, r) // io.Copy(dst Writer, src Reader) reads from src and writes to dst until EOF or error
}
```

So, because any type with the right method set fits the interface, functions like `io.Copy` can work on any readable/writable thing — files, network sockets, buffers, etc. - without them being in the same inheritance tree.

*And that's the key point here: this approach basically renders inheritance useless. You don't need a class hierarchy to achieve polymorphism; you just need types that implement the right methods.*

### Composition via Embedding Interfaces

In Go, interfaces can be composed from other interfaces by simply listing them inside another interface. This is called embedding.

The new interface inherits all the methods of the embedded interfaces. It's like building larger interfaces out of smaller, focused ones.

```go
package main

import "fmt"

// Two small, focused interfaces
type Reader interface {
	Read(p []byte) (n int, err error)
}

type Writer interface {
	Write(p []byte) (n int, err error)
}

// New interface composed from the two
type ReadWriter interface {
	Reader
	Writer
}

// A type that implements both Read and Write automatically implements ReadWriter
type MyBuffer struct {
	data []byte
}

func (b *MyBuffer) Read(p []byte) (int, error) {
	n := copy(p, b.data)
	return n, nil
}

func (b *MyBuffer) Write(p []byte) (int, error) {
	b.data = append(b.data, p...)
	return len(p), nil
}

func main() {
	var rw ReadWriter = &MyBuffer{}
	rw.Write([]byte("hello"))
	buf := make([]byte, 5)
	rw.Read(buf)
	fmt.Println(string(buf))
}
```

So you can break functionality into small interfaces (`Reader`, `Writer`), then combine them into richer ones (`ReadWriter`), with *composition*, not *inheritance*. This is a powerful way to build flexible and reusable components, without the rigidity of class hierarchies.

### Interfaces with One Method

This is a common pattern in Go. Many interfaces only have one method, which makes them easy to implement and use. Single-method interfaces are like Lego bricks - small, easy to snap together, and infinitely reusable.

One use case is when we add behavior to existing types without modifying them. For example, the `fmt.Stringer` interface:

```go
package main

import (
	"fmt"
)

// From fmt package:
// type Stringer interface {
//     String() string
// }

// Define a new named type based on int
type MyInt int

// Add the method required by Stringer
func (m MyInt) String() string {
	return fmt.Sprintf("MyInt value: %d", m)
}

func main() {
	var s fmt.Stringer

	// Works because MyInt has a String() method, therefore it satisfies fmt.Stringer
	s = MyInt(42)
	fmt.Println(s) // Prints: MyInt value: 42
}
```

The key points here:
1. We didn't touch `fmt.Stringer` (it's in the standard library).
2. We didn't modify `int` - we just defined our own `MyInt` type based on `int`.
3. By adding a single method, `MyInt` now satisfies `fmt.Stringer`.
4. Any function expecting a `fmt.Stringer` can now accept `MyInt`.

One of the benefits of this approach is `loose coupling`. With inheritance the child class implements *all* methods of the parent class, which means if anything changes in the parent, it can break the child. In Go, you start with zero dependencies and only add what you need.

### The `interface{}` (Empty Interface) Hell

`interface{}` is Go’s empty interface — an interface with zero methods. It matches any type because every type implements zero or more methods, so every type satisfies an empty interface. It's like `Object` in Java or `any` in TypeScript.

So you can do this:

```go
var x interface{}
x = 42              // int
x = "hello"         // string
x = []int{1, 2, 3}  // slice of int
```

Before Go had generics, `interface{}` was often used to write functions or containersthat could accept any type. But it's easy to see how this can be misused. You lose type safety, break compile-time type safety, pushing errors to runtime. You have to use frequent type assertions or type switches to work with the value, which clutters your code and makes it harder to read.

This is often referred to as *interface{} hell*. You end up with code that looks like this:

```go
func PrintAnything(v interface{}) {
	switch v := v.(type) {
	case int:
		fmt.Println("int:", v)
	case string:
		fmt.Println("string:", v)
	case []int:
		fmt.Println("[]int:", v)
	default:
		fmt.Println("unknown type")
	}
}

func main() {
  PrintAnything(42)
  PrintAnything("hello")
  PrintAnything([]int{1, 2, 3})
}
```

So, if you must use `interface{}`, keep the use localized and minimal.

## The Bad And The Ugly

We saw how Go interfaces work and how they can give you flexibility and power. But they also come with their own set of quirks and frustrations. Here are some common pain points:

### No Explicit "Implements"

If you look at a Go type, you can't tell at a glance which interfaces it implements. You have to read the code and see if it has the right methods. This can make it hard to understand how types relate to each other. Your IDE won't help you find all the places where a type is used as an interface, and you can't easily search for implementations of an interface.

### No easy way to declare optional interface methods

In Go, interfaces are satisfied only if a type implements all the methods declared. There is no built-in support for optional methods — you can’t say "a type may implement method X, but it’s not required."

This means that if you want to design an interface with optional behavior, you usually have to:
- Split the interface into multiple smaller interfaces.
- Check at runtime whether the type implements the optional interface by doing a type assertion.

For example:

```go
type Logger interface {
    Log(msg string)
}

type WarnLogger interface {
    Logger
    Warn(msg string)
}

func UseLogger(l Logger) {
    l.Log("info")

    if wl, ok := l.(WarnLogger); ok {
        wl.Warn("warning")
    }
}
```

Here, Warn() is optional — you check at runtime if the logger supports it. This pattern is verbose and repetitive in many places where optional behavior is desired.

### Error handling and delegation can be repetitive

When delegating calls to embedded interfaces or composed structs, you often write boilerplate code that:
- Checks errors.
- Passes method calls through.
- Wraps or annotates errors.

Since Go doesn't have inheritance or automatic delegation like some OOP languages, you write this manually.

For example:

```go
type MyWriter struct {
    w io.Writer
}

func (m *MyWriter) Write(p []byte) (int, error) {
    n, err := m.w.Write(p)
    if err != nil {
        return n, fmt.Errorf("write failed: %w", err)
    }
    return n, nil
}
```

This small wrapper adds error wrapping, but the code has to be written for each method manually. For interfaces with many methods, this boilerplate quickly adds up.

### Reflection Needed for Some Dynamic Uses

In Go, if you want to inspect types at runtime or dynamically invoke methods, you often have to use the `reflect` package.

Example: imagine you want to write a generic function that prints all fields of any struct:

```go
func PrintFields(v interface{}) {
    val := reflect.ValueOf(v)
    typ := val.Type()

    if val.Kind() != reflect.Struct {
        fmt.Println("Not a struct")
        return
    }

    for i := 0; i < val.NumField(); i++ {
        field := val.Field(i)
        fmt.Printf("%s = %v\n", typ.Field(i).Name, field.Interface())
    }
}
```

This is powerful, but it can also lead to code that is hard to understand and maintain. You lose the compile-time type safety that Go is known for, and you have to deal with the complexities of reflection: verbose and complex syntax, runtime errors if you get types or method names wrong and performance overhead compared to direct calls.

### Interface Pollution

In Go, it's common to see interfaces exported instead of structs. This can lead to interface pollution, where you end up with many small interfaces that are used everywhere, making it hard to track down where a type is used. This is especially true in large codebases or when using third-party libraries.

## How to Work With It (Best Practices)

To avoid the pitfalls of Go interfaces, here are some best practices:

1. **Use Small Interfaces**: Prefer small, focused interfaces over large, monolithic ones. This makes it easier to implement, understand and reuse. For example, use `io.Writer` instead of a big `BigAbstractThing` interface.
2. **Accept Interfaces, Return Structs**: When designing functions, accept interfaces as parameters but return concrete types. This allows you to use the interface's flexibility while keeping the implementation details hidden.
3. **Make Interface Implementations Explicit**: Use `var _ Interface = (*Type)(nil)` to make it explicit that a type implements an interface. This can help catch errors at compile time and improve code readability.
4. **Avoid `interface{}` Unless Necessary**: Use the empty interface sparingly. If you find yourself using it often, consider whether you can define a more specific interface instead. Or use generics.
5. **Use Type Assertions Carefully**: If you need to use type assertions, do so in a controlled manner. Prefer type switches over multiple assertions, and document the expected types clearly.
6. **Keep Interfaces Localized**: If an interface is only used in one package, keep it there. Don't export it unless necessary. This reduces interface pollution and makes your code easier to navigate.

Following these practices can help you write cleaner, more maintainable Go code that leverages the power of interfaces without falling into the common traps. It's still not as straightforward as in some other languages, but with a bit of common sense and experience, you can make it work for you. Good luck, you'll need it!

## Closing Thoughts

We saw how Go interfaces work from a technical perspective. But I think because they just feel so weird, the biggest challenge is the mindset shift. In Go, interfaces just happen, sometimes without you even realizing it. You write a type, and suddenly it satisfies an interface. Like seriously?

Sometimes it can be a good thing. Decoupling your code from specific implementations can lead to more flexible and reusable components. Mocking becomes a breeze, and you can swap out implementations without changing the code that uses them.

But it can also lead to confusion and frustration. You might find yourself wondering why your type doesn't satisfy an interface, or why the compiler isn't complaining when you think it should. The lack of explicit contracts can make it hard to understand how types relate to each other, and the implicit nature of interface satisfaction can lead to unexpected behavior.

Good thing is, you don't have to like it. Bad thing is, you have to understand them to use Go effectively. So embrace the weirdness, learn the patterns, and remember that Go interfaces are just another tool in your toolbox. They might not be what you're used to, but with a bit of practice, you will know how to tolerate them.