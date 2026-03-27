export interface ManagedSkill {
  id: string
  name: string
  description: string
  directoryPath: string
  entryPath: string
  body: string
  hasFrontmatter: boolean
}

export interface SkillsSyncResponse {
  managedRootPath: string
  skills: ManagedSkill[]
}
