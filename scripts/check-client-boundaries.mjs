import {readdir,readFile} from "node:fs/promises"
import path from "node:path"
import ts from "typescript"

const roots=["app","components","hooks","lib"]
const extensions=new Set([".ts",".tsx"])
const mutationMethods=new Set(["insert","update","upsert","delete"])
const serverReadTables=new Set(["providers","services","reviews","favorites"])

async function sourceFiles(directory){
  const files=[]
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const target=path.join(directory,entry.name)
    if(entry.isDirectory())files.push(...await sourceFiles(target))
    else if(extensions.has(path.extname(entry.name))&&!entry.name.endsWith(".d.ts"))files.push(target)
  }
  return files
}

function isClientModule(source){
  const first=source.statements[0]
  return !!first&&ts.isExpressionStatement(first)&&ts.isStringLiteral(first.expression)
    &&first.expression.text==="use client"
}

function inspectSource(file,text){
  const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,
    file.endsWith(".tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS)
  if(!isClientModule(source))return[]
  const violations=[]
  const tableQueryVariables=new Set()
  const line=(node)=>source.getLineAndCharacterOfPosition(node.getStart(source)).line+1

  function walk(node){
    if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)
      &&node.moduleSpecifier.text==="@/lib/supabase/admin"){
      violations.push({file,line:line(node),reason:"client module imports the service-role client"})
    }
    if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer){
      const initializer=node.initializer.getText(source)
      if(initializer.includes(".from(")&&!initializer.includes(".storage"))tableQueryVariables.add(node.name.text)
    }
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)){
      const method=node.expression.name.text
      const receiver=node.expression.expression
      const receiverText=receiver.getText(source)
      if(method==="from"&&node.arguments.length>0&&ts.isStringLiteral(node.arguments[0])
        &&serverReadTables.has(node.arguments[0].text)){
        violations.push({file,line:line(node),reason:`client module reads public.${node.arguments[0].text} directly`})
      }else if(method==="rpc"){
        violations.push({file,line:line(node),reason:"client module calls a database RPC directly"})
      }else if(mutationMethods.has(method)){
        const directTable=receiverText.includes(".from(")&&!receiverText.includes(".storage")
        const storedTableQuery=ts.isIdentifier(receiver)&&tableQueryVariables.has(receiver.text)
        if(directTable||storedTableQuery){
          violations.push({file,line:line(node),reason:`client module calls table .${method}() directly`})
        }
      }
    }
    ts.forEachChild(node,walk)
  }
  walk(source)
  return violations
}

const guardProbe=inspectSource("guard-probe.tsx",`"use client";
const q=supabase.from("orders");q.update({status:"paid"});
supabase.from("profiles").delete();supabase.from("providers").select("id");supabase.rpc("unsafe_write");`)
if(guardProbe.length!==4)throw new Error("Client boundary guard self-check failed")

const files=(await Promise.all(roots.map(sourceFiles))).flat().sort()
const violations=[]
let clients=0
for(const file of files){
  const text=await readFile(file,"utf8")
  const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,
    file.endsWith(".tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS)
  if(isClientModule(source))clients+=1
  violations.push(...inspectSource(file,text))
}
if(violations.length){
  for(const violation of violations)console.error(`${violation.file}:${violation.line}: ${violation.reason}`)
  process.exitCode=1
}else{
  console.log(`Client boundary check passed: ${clients} client modules, no restricted table reads, direct table mutations, RPC calls, or service-role imports.`)
}
