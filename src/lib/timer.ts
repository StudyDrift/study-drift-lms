export class DebugTimer {
  start = new Date()

  tick(name: string) {
    console.log(
      `Timer: ${name} - ${new Date().getTime() - this.start.getTime()}ms`
    )
  }
}
