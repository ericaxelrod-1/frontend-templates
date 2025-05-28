import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';

interface FileInfo {
  filePath: string;
  sourceFile: ts.SourceFile;
  program: ts.Program;
}

function createProgram(rootFiles: string[]): ts.Program {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    strict: true,
  };

  const host = ts.createCompilerHost(options);
  return ts.createProgram(rootFiles, options, host);
}

function findTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findTypeScriptFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

function addAccessibilityModifiers(sourceFile: ts.SourceFile): string {
  const printer = ts.createPrinter();
  const result = ts.transform(sourceFile, [
    (context: ts.TransformationContext) => {
      const visitor = (node: ts.Node): ts.Node => {
        if (ts.isPropertyDeclaration(node)) {
          if (!node.modifiers?.some(m => 
            m.kind === ts.SyntaxKind.PublicKeyword || 
            m.kind === ts.SyntaxKind.PrivateKeyword || 
            m.kind === ts.SyntaxKind.ProtectedKeyword
          )) {
            return ts.factory.updatePropertyDeclaration(
              node,
              [ts.factory.createModifier(ts.SyntaxKind.PrivateKeyword), ...(node.modifiers || [])],
              node.name,
              node.questionToken,
              node.type,
              node.initializer
            );
          }
        } else if (ts.isMethodDeclaration(node)) {
          if (!node.modifiers?.some(m => 
            m.kind === ts.SyntaxKind.PublicKeyword || 
            m.kind === ts.SyntaxKind.PrivateKeyword || 
            m.kind === ts.SyntaxKind.ProtectedKeyword
          )) {
            return ts.factory.updateMethodDeclaration(
              node,
              [ts.factory.createModifier(ts.SyntaxKind.PrivateKeyword), ...(node.modifiers || [])],
              node.asteriskToken,
              node.name,
              node.questionToken,
              node.typeParameters,
              node.parameters,
              node.type,
              node.body
            );
          }
        }
        return ts.visitEachChild(node, visitor, context);
      };
      return (node: ts.Node) => ts.visitNode(node, visitor);
    }
  ]);

  return printer.printFile(result.transformed[0] as ts.SourceFile);
}

function addExplicitTypes(sourceFile: ts.SourceFile, program: ts.Program): string {
  const typeChecker = program.getTypeChecker();
  const printer = ts.createPrinter();
  
  const result = ts.transform(sourceFile, [
    (context: ts.TransformationContext) => {
      const visitor = (node: ts.Node): ts.Node => {
        if (ts.isParameter(node) && !node.type) {
          const type = typeChecker.getTypeAtLocation(node);
          const typeNode = typeChecker.typeToTypeNode(
            type,
            undefined,
            ts.NodeBuilderFlags.NoTruncation
          );
          
          if (typeNode) {
            return ts.factory.updateParameterDeclaration(
              node,
              node.modifiers,
              node.dotDotDotToken,
              node.name,
              node.questionToken,
              typeNode,
              node.initializer
            );
          }
        }
        return ts.visitEachChild(node, visitor, context);
      };
      return (node: ts.Node) => ts.visitNode(node, visitor);
    }
  ]);

  return printer.printFile(result.transformed[0] as ts.SourceFile);
}

function fixFile(fileInfo: FileInfo): void {
  let content = fs.readFileSync(fileInfo.filePath, 'utf-8');
  
  // Add accessibility modifiers
  content = addAccessibilityModifiers(fileInfo.sourceFile);
  
  // Add explicit types
  content = addExplicitTypes(fileInfo.sourceFile, fileInfo.program);
  
  fs.writeFileSync(fileInfo.filePath, content);
}

async function main(): Promise<void> {
  const srcDir = path.join(__dirname, '..', 'src');
  const testDir = path.join(__dirname, '..', 'test');
  
  const files = [
    ...findTypeScriptFiles(srcDir),
    ...findTypeScriptFiles(testDir)
  ];
  
  const program = createProgram(files);
  
  for (const filePath of files) {
    const sourceFile = program.getSourceFile(filePath);
    if (sourceFile) {
      const fileInfo: FileInfo = {
        filePath,
        sourceFile,
        program
      };
      
      try {
        fixFile(fileInfo);
        console.log(`Fixed ESLint issues in: ${filePath}`);
      } catch (error) {
        console.error(`Error fixing file ${filePath}:`, error);
      }
    }
  }
}

main().catch(console.error); 